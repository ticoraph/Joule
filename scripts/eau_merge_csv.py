"""Expand the few yearly Eau du Grand Chambery water meter readings
(scripts/water_download.py output) into a daily consumption table.

The meter is read about once a year (around Oct 20) plus a handful of extra
recent readings, so between two consecutive readings the only known fact is
the total consumption (their index delta) over that whole span - there's no
daily granularity to read from the source. This script spreads each
interval's total across its days using a smoothed seasonal profile (May-Sept
consumption +20% above the rest of the year, peaking around July 15), while
guaranteeing the daily values for any given interval sum back exactly to its
real recorded delta.

Usage (from repo root):
    python scripts/eau_merge_csv.py [--raw-dir data/raw] [--processed-dir data/processed]
"""

import argparse
import csv
import logging
import math
import os
from datetime import date, datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw"
DEFAULT_PROCESSED_DIR = REPO_ROOT / "data" / "processed"
MERGED_CSV_NAME = "EAU_ByDay.csv"
# Water meter reference as shown by the portal (account-specific): set WATER_METER_REF in the environment.
METER_REF = os.environ.get("WATER_METER_REF", "")
LOG_DIR = REPO_ROOT / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("eau_merge_csv")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "eau_merge_csv.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

SUMMER_BASE_BOOST = 0.2  # summer (May-Sept) averages +20% vs the rest of the year
SUMMER_PEAK_BOOST = 0.3  # extra bump at the July 15 peak within summer


def summer_weight(d: date) -> float:
    """1.0 outside May-Sept; inside summer, 1.2 at the May 1/Sept 30 edges
    rising smoothly to 1.5 on July 15."""
    if d.month not in (5, 6, 7, 8, 9):
        return 1.0
    summer_start = date(d.year, 5, 1)
    summer_end = date(d.year, 9, 30)
    peak = date(d.year, 7, 15)
    span = max((peak - summer_start).days, (summer_end - peak).days)
    distance = abs((d - peak).days)
    bump = math.cos((math.pi / 2) * distance / span)
    return 1.0 + SUMMER_BASE_BOOST + SUMMER_PEAK_BOOST * bump


def latest_file(raw_dir: Path, prefix: str) -> Path:
    matches = sorted(raw_dir.glob(f"{prefix}_*.csv"))
    if not matches:
        raise SystemExit(f"Aucun fichier {prefix}_*.csv dans {raw_dir}")
    return matches[-1]


def load_readings(raw_path: Path) -> list[tuple[date, int]]:
    readings = []
    with open(raw_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["Reference_equipement"] != METER_REF or not row["Index"]:
                continue
            d = datetime.strptime(row["Date"], "%d/%m/%Y").date()
            readings.append((d, int(row["Index"])))

    # The meter index can only increase, so sorting by index gives the true
    # chronological order even if a date is corrupted at the source (the
    # eauenligne export has at least one mistyped year, e.g. "2011" for
    # "2021"). Walk that order and, for any reading whose date doesn't come
    # after the previous one, fix its year to be the previous reading's
    # year + 1 - consistent with this meter being read about once a year.
    readings.sort(key=lambda r: r[1])
    for i in range(1, len(readings)):
        prev_date, _ = readings[i - 1]
        d, idx = readings[i]
        if d <= prev_date:
            readings[i] = (d.replace(year=prev_date.year + 1), idx)
    readings.sort(key=lambda r: r[0])
    return readings


def expand_to_daily(readings: list[tuple[date, int]]) -> dict[str, tuple[str, str]]:
    rows: dict[str, tuple[str, str]] = {}
    for (start_date, start_index), (end_date, end_index) in zip(readings, readings[1:]):
        delta = end_index - start_index
        days = [start_date + timedelta(days=i + 1) for i in range((end_date - start_date).days)]
        weights = [summer_weight(d) for d in days]
        total_weight = sum(weights)

        # Round the running cumulative target (not each day independently),
        # so per-day rounding errors don't compound - the last day's
        # cumulative target is exactly delta, so the days always sum to it.
        running_index = start_index
        cumulative_weight = 0.0
        previous_rounded = 0
        for d, weight in zip(days, weights):
            cumulative_weight += weight
            rounded = round(delta * cumulative_weight / total_weight)
            conso = rounded - previous_rounded
            previous_rounded = rounded
            running_index += conso
            rows[d.strftime("%Y%m%d")] = (str(conso), str(running_index))
    return rows


def main(raw_dir: Path, processed_dir: Path) -> None:
    raw_path = latest_file(raw_dir, "water")
    readings = load_readings(raw_path)
    if len(readings) < 2:
        raise SystemExit("Pas assez de releves dans le fichier source pour interpoler")

    rows = expand_to_daily(readings)
    first_date, first_index = readings[0]
    rows.setdefault(first_date.strftime("%Y%m%d"), ("", str(first_index)))

    processed_dir.mkdir(parents=True, exist_ok=True)
    target_path = processed_dir / MERGED_CSV_NAME
    with open(target_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Date", "EAU_Conso", "EAU_Index_Total"])
        for date_key in sorted(rows):
            conso, index = rows[date_key]
            writer.writerow([date_key, conso, index])

    last_date, _ = readings[-1]
    logger.info(
        f"{raw_path.name} -> {MERGED_CSV_NAME} "
        f"({len(rows)} jours, releves {first_date:%d/%m/%Y}-{last_date:%d/%m/%Y})"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--processed-dir", type=Path, default=DEFAULT_PROCESSED_DIR)
    args = parser.parse_args()
    main(args.raw_dir, args.processed_dir)
