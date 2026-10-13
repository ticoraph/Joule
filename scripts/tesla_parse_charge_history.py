"""Extract Tesla charge_history (kWh charged, by day/month) from a mitmproxy capture.

The Tesla app has no public Fleet API endpoint for charge history, so this
data only exists by intercepting the official app's traffic to
owner-api.teslamotors.com. A capture is recorded with mitmproxy (e.g.
`mitmdump -w data/mitmproxy/tesla_flows` while proxying the Tesla iOS/Android app, or
the mitmweb UI) and saved on disk as a stream of mitmproxy "flow" objects -
each one a tnetstring-encoded dict with `request`/`response` (the same
format mitmproxy uses for its own `.mitm` save files).

This script replays that capture with mitmproxy's own `FlowReader`, picks
out every request whose path contains `/charge_history`, and flattens the
nested JSON response (`response.graph.graph.data_points[].values[]`,
ordered total/home/super_charger/work/other for both kWh and cost-in-EUR)
into one row per day or month.

Multiple overlapping captures of the same vehicle/period are common (the
app re-fetches the same month repeatedly); for a given (vin, granularity,
period) the last occurrence in the capture wins, since flows are stored in
chronological order and later calls reflect more up-to-date totals.

Writes the full detail (day + month granularity, raw Wh/EUR figures) to
data/raw/tesla_charge_history.csv, and a day-granularity-only,
kWh-converted data/processed/TES_ByDay.csv (columns prefixed TES_) for
scripts/final_processing.py to merge into the dataset like every other
source.

Usage (from repo root):
    python scripts/tesla_parse_charge_history.py
    python scripts/tesla_parse_charge_history.py --capture data/mitmproxy/tesla_flows --out data/raw/tesla_charge_history.csv
"""

import argparse
import csv
import json
import logging
from pathlib import Path
from urllib.parse import urlparse

from mitmproxy.io import FlowReader

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CAPTURE = REPO_ROOT / "data" / "mitmproxy" / "tesla_flows"
DEFAULT_OUT = REPO_ROOT / "data" / "raw" / "tesla_charge_history.csv"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
PROCESSED_CSV_NAME = "TES_ByDay.csv"
LOG_DIR = REPO_ROOT / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("tesla_parse_charge_history")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "tesla_parse_charge_history.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

# day-granularity kWh columns (raw_value is in Wh) mapped to their TES_*
# kWh column; total cost is kept, per-source costs are dropped as the
# dataset only needs total spend.
BYDAY_KWH_COLUMNS = {
    "total_kwh": "TES_TotalKwh",
    "home_kwh": "TES_HomeKwh",
    "supercharger_kwh": "TES_SuperchargerKwh",
    "work_kwh": "TES_WorkKwh",
    "other_kwh": "TES_OtherKwh",
}
BYDAY_FIELDNAMES = ["Date", *BYDAY_KWH_COLUMNS.values(), "TES_TotalCostEur"]

# order of the per-period `values` list in the charge_history response: kWh
# entries first (total + 4 source breakdowns), then the mirrored cost-in-EUR
# entries in the same source order - confirmed against the `sub_title`
# ("Domicile - Superchargeur - Autre") on the total entry.
VALUE_FIELDS = [
    "total_kwh",
    "home_kwh",
    "supercharger_kwh",
    "work_kwh",
    "other_kwh",
    "total_cost_eur",
    "home_cost_eur",
    "supercharger_cost_eur",
    "work_cost_eur",
    "other_cost_eur",
]
FIELDNAMES = ["vin", "granularity", "period", "timestamp"] + VALUE_FIELDS


def iter_charge_history_responses(capture_path: Path):
    with capture_path.open("rb") as f:
        for flow in FlowReader(f).stream():
            request = getattr(flow, "request", None)
            response = getattr(flow, "response", None)
            if request is None or response is None:
                continue
            if "/charge_history" not in request.path:
                continue
            try:
                vin = request.path.split("/vehicles/")[1].split("/")[0]
                interval = urlparse(request.path).query
                granularity = "day" if "interval=day" in interval else "month"
                body = json.loads(response.get_text(strict=False))
            except Exception:
                continue
            yield vin, granularity, body.get("response", {})


def flatten(vin: str, granularity: str, response: dict) -> dict[tuple, dict]:
    rows = {}
    for point in response.get("graph", {}).get("graph", {}).get("data_points", []):
        period = point["timestamp"]["display_string"]
        timestamp = point["timestamp"]["timestamp"].get("seconds")
        values = point.get("values", [])
        row = {"vin": vin, "granularity": granularity, "period": period, "timestamp": timestamp}
        for field, value in zip(VALUE_FIELDS, values):
            row[field] = value.get("raw_value")
        rows[(vin, granularity, period)] = row
    return rows


def write_by_day_csv(rows: dict[tuple, dict]) -> Path:
    """Day-granularity rows only, Wh->kWh, keyed by YYYYMMDD for the dataset merge."""
    by_day: dict[str, dict] = {}
    for (_, granularity, period), row in rows.items():
        if granularity != "day":
            continue
        date_key = period.replace("-", "")
        out_row = {"Date": date_key}
        for field, column in BYDAY_KWH_COLUMNS.items():
            raw_wh = row.get(field)
            out_row[column] = f"{raw_wh / 1000:.3f}" if raw_wh not in (None, "") else ""
        total_cost = row.get("total_cost_eur")
        out_row["TES_TotalCostEur"] = f"{total_cost:.2f}" if total_cost not in (None, "") else ""
        by_day[date_key] = out_row

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    processed_path = PROCESSED_DIR / PROCESSED_CSV_NAME
    with processed_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=BYDAY_FIELDNAMES)
        writer.writeheader()
        for date_key in sorted(by_day):
            writer.writerow(by_day[date_key])

    return processed_path


def main(capture_path: Path, out_path: Path) -> None:
    rows: dict[tuple, dict] = {}
    for vin, granularity, response in iter_charge_history_responses(capture_path):
        rows.update(flatten(vin, granularity, response))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for row in sorted(rows.values(), key=lambda r: (r["vin"], r["granularity"], r["period"])):
            writer.writerow(row)
    logger.info(f"Wrote {len(rows)} rows to {out_path}")

    processed_path = write_by_day_csv(rows)
    logger.info(f"Wrote {processed_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, default=DEFAULT_CAPTURE, help="mitmproxy capture file")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output CSV path")
    args = parser.parse_args()
    main(args.capture, args.out)
