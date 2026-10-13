"""Download daily solar/home/battery energy totals from EcoFlow's private app
API (the same one the iOS app uses), which - unlike the official Open
Platform API (which only exposes instantaneous device status, not daily
totals) - exposes EcoFlow's own pre-computed daily totals directly. No
polling/integration needed.

Endpoint discovered by capturing the iOS app's traffic with mitmproxy (see
scripts/mitm_capture.sh): POST https://api-e.ecoflow.com/iot-service/index/common/query
Confirmed experimentally that the server only checks the `Authorization`
Bearer token - the `x-sign`/`x-nonce`/timestamp headers the app also sends
are not actually validated for this read endpoint, so a single captured
token is enough to query any date range until it expires (the JWT `exp`
claim is ~30 days after login).

Getting a token (manual, repeat every ~30 days when it expires):
    1. Capture the app's traffic with mitmproxy into data/mitmproxy/ecoflow_flows
       (scripts/mitm_capture.sh), e.g.
           mitmdump -w data/mitmproxy/ecoflow_flows
    2. This script then reads that capture file itself (mitmproxy's own
       FlowReader, the same way scripts/tesla_parse_charge_history.py reads
       data/mitmproxy/tesla_flows for Tesla) and pulls the `authorization`
       header and `groupId` from the last /iot-service/index/common/query
       request in it - no manual copy/paste.

Falls back to private/ecoflow_app.env (not committed) if set - useful to pin
a token without needing the raw capture file around:
    ECOFLOW_APP_BEARER=Bearer eyJ...
    ECOFLOW_APP_GROUP_ID=240958

Usage (from repo root):
    python scripts/ecoflow_app_download.py                    # whole previous calendar month (default)
    python scripts/ecoflow_app_download.py --date 2026-06-23
    python scripts/ecoflow_app_download.py --start 2026-07-01 --end 2026-07-31
    python scripts/ecoflow_app_download.py --capture data/mitmproxy/ecoflow_flows

Writes/updates data/processed/ECO_ByDay.csv, one row per day (idempotent:
re-running for a date already present overwrites that row). Columns other
than Date are prefixed ECO_ and suffixed _kWh (converted from the API's raw
Wh values, rounded to 1 decimal) for the dataset merge in
scripts/final_processing.py.
"""

import argparse
import csv
import json
import logging
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from mitmproxy.io import FlowReader

REPO_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
PROCESSED_CSV = PROCESSED_DIR / "ECO_ByDay.csv"
ENV_FILE = REPO_ROOT / "private" / "ecoflow_app.env"
LOG_DIR = REPO_ROOT / "logs"
DEFAULT_CAPTURE = REPO_ROOT / "data" / "mitmproxy" / "ecoflow_flows"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("ecoflow_app_download")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "ecoflow_app_download.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

BASE_URL = "https://api-e.ecoflow.com"
QUERY_PATH = "/iot-service/index/common/query"

FIELDNAMES = [
    "Date",
    "ECO_SolarTotalGeneration_kWh",
    "ECO_SolarToBattery_kWh",
    "ECO_SolarToGrid_kWh",
    "ECO_SolarToHome_kWh",
    "ECO_HomeSystemForFamilies_kWh",
    "ECO_HomeFamilyNeeds_kWh",
    "ECO_HomeToLoads_kWh",
    "ECO_HomeToSmartPlug_kWh",
    "ECO_BatteryTotalDischarging_kWh",
    "ECO_BatteryTotalCharging_kWh",
]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def credentials_from_capture(capture_path: Path) -> tuple[str, str] | None:
    """Extract the bearer token + groupId from the last
    /iot-service/index/common/query request in a mitmdump capture file. Last
    occurrence wins, since a fresh re-login later in the same capture
    invalidates any earlier token."""
    bearer = group_id = None
    with capture_path.open("rb") as f:
        for flow in FlowReader(f).stream():
            request = getattr(flow, "request", None)
            if request is None or QUERY_PATH not in request.path:
                continue
            auth = request.headers.get("authorization")
            if not auth:
                continue
            try:
                body = json.loads(request.get_text(strict=False))
                gid = body["params"]["groupId"]
            except Exception:
                continue
            bearer, group_id = auth, gid

    if bearer and group_id:
        return bearer, group_id
    return None


def query(bearer: str, group_id: str, code: str, day: date) -> dict[str, float]:
    begin_time = f"{day.isoformat()} 00:00:00"
    end_time = f"{day.isoformat()} 23:59:59"
    body = {"code": code, "params": {"groupId": group_id, "beginTime": begin_time, "endTime": end_time}}
    headers = {"authorization": bearer, "content-type": "application/json"}
    response = requests.post(f"{BASE_URL}{QUERY_PATH}", headers=headers, json=body, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if str(payload.get("code")) != "0":
        raise RuntimeError(f"EcoFlow API error for {code} on {day}: {payload}")
    return {item["indexName"]: item.get("indexValue") for item in payload["data"]}


def fetch_day(bearer: str, group_id: str, day: date) -> dict[str, str]:
    solar = query(bearer, group_id, "WN511-System-Solar-Day-Single", day)
    home = query(bearer, group_id, "WN511-System-Home-Day-Single", day)
    battery = query(bearer, group_id, "WN511-System-Battery-Day-Single", day)

    def fmt(value: float | None) -> str:
        return "" if value is None else str(round(value / 1000, 1))

    return {
        "Date": day.strftime("%Y%m%d"),
        "ECO_SolarTotalGeneration_kWh": fmt(solar.get("total_generation")),
        "ECO_SolarToBattery_kWh": fmt(solar.get("to_battery")),
        "ECO_SolarToGrid_kWh": fmt(solar.get("to_grid")),
        "ECO_SolarToHome_kWh": fmt(solar.get("to_home")),
        "ECO_HomeSystemForFamilies_kWh": fmt(home.get("system_for_families")),
        "ECO_HomeFamilyNeeds_kWh": fmt(home.get("family_needs")),
        "ECO_HomeToLoads_kWh": fmt(home.get("to_loads")),
        "ECO_HomeToSmartPlug_kWh": fmt(home.get("to_smart_plug")),
        "ECO_BatteryTotalDischarging_kWh": fmt(battery.get("total_discharging")),
        "ECO_BatteryTotalCharging_kWh": fmt(battery.get("total_charging")),
    }


def upsert_rows(new_rows: list[dict[str, str]]) -> Path:
    rows_by_date: dict[str, dict[str, str]] = {}
    if PROCESSED_CSV.exists():
        with open(PROCESSED_CSV, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                rows_by_date[row["Date"]] = row

    for row in new_rows:
        rows_by_date[row["Date"]] = row

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    with open(PROCESSED_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for day in sorted(rows_by_date):
            writer.writerow(rows_by_date[day])

    return PROCESSED_CSV


def daterange(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", help="Single day to fetch, YYYY-MM-DD (default: whole previous month)")
    parser.add_argument("--start", help="Backfill start date, YYYY-MM-DD")
    parser.add_argument("--end", help="Backfill end date, YYYY-MM-DD (default: today)")
    parser.add_argument(
        "--capture", type=Path, default=DEFAULT_CAPTURE, help="mitmproxy capture file"
    )
    args = parser.parse_args()

    creds = credentials_from_capture(args.capture) if args.capture.exists() else None
    if creds:
        bearer, group_id = creds
    else:
        load_env_file(ENV_FILE)
        bearer = os.environ.get("ECOFLOW_APP_BEARER")
        group_id = os.environ.get("ECOFLOW_APP_GROUP_ID")
    if not bearer or not group_id:
        raise SystemExit(
            f"Manque le token EcoFlow: ni capture mitmproxy ({args.capture}) ni "
            f"ECOFLOW_APP_BEARER/ECOFLOW_APP_GROUP_ID (env ou {ENV_FILE})."
        )

    if args.start:
        start = date.fromisoformat(args.start)
        end = date.fromisoformat(args.end) if args.end else date.today()
    elif args.date:
        start = end = date.fromisoformat(args.date)
    else:
        # previous calendar month, e.g. run on 2026-10-01 -> 2026-09-01..2026-09-30
        end = date.today().replace(day=1) - timedelta(days=1)
        start = end.replace(day=1)

    new_rows = [fetch_day(bearer, group_id, day) for day in daterange(start, end)]
    csv_path = upsert_rows(new_rows)
    logger.info(f"{len(new_rows)} jour(s) ecrit(s) dans: {csv_path}")


if __name__ == "__main__":
    main()
