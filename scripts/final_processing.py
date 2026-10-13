"""Merge every CSV in data/processed/ into a single CSV with one row per
calendar day and every source's columns side by side.

Every data/processed/*_ByDay.csv file is expected to have a Date column already in
YYYYMMDD format (see scripts/enedis_xlsx_to_csv.py, ecoflow_app_download.py,
infoclimat_download.py) plus its own value columns, and may not cover the
same days. This outer-joins all of them on Date (a day missing from one
source just leaves its columns blank for that row) and writes the result to
data/dataset/Final-ByDay.csv, which scripts/transformation_processing.py then turns into the
model-ready data/dataset/Transformation-ByDay.csv.

SUN_ByDay.csv is a special case: sunrise/sunset times only depend on the
calendar day, not the year, so it has one row per MMDD instead of YYYYMMDD
and is repeated onto every year present in the other sources rather than
outer-joined by exact Date.

Other CSVs there (e.g. AQR_ByDay_Monthly.csv, the hand-typed monthly totals
used by aqara_download_app.py) are not daily sources and are skipped.

Dropping a new *_ByDay.csv into data/processed/ picks it up automatically -
no script changes needed, as long as its Date column is YYYYMMDD.

Usage (from repo root):
    python scripts/final_processing.py [--processed-dir data/processed] [--output-dir data/dataset] [--output Final-ByDay.csv]
"""

import argparse
import csv
import logging
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROCESSED_DIR = REPO_ROOT / "data" / "processed"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "data" / "dataset"
DEFAULT_OUTPUT_NAME = "Final-ByDay.csv"
LOG_DIR = REPO_ROOT / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("final_processing")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "final_processing.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())


def merge(processed_dir: Path, output_dir: Path, output_name: str) -> None:
    rows: dict[str, dict[str, str]] = {}
    fieldnames: list[str] = ["Date"]
    sun_path = processed_dir / "SUN_ByDay.csv"

    for path in sorted(processed_dir.glob("*_ByDay.csv")):
        if path == sun_path:
            continue
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            value_columns = [c for c in reader.fieldnames if c != "Date"]
            fieldnames.extend(c for c in value_columns if c not in fieldnames)

            for row in reader:
                merged_row = rows.setdefault(row["Date"], {})
                for column in value_columns:
                    merged_row[column] = row[column]
        logger.info(f"Fusionne: {path.name} ({len(rows)} jours cumules)")

    if sun_path.exists():
        with open(sun_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            value_columns = [c for c in reader.fieldnames if c != "Date"]
            fieldnames.extend(c for c in value_columns if c not in fieldnames)
            sun_by_mmdd = {row["Date"]: row for row in reader}

        for date_key, merged_row in rows.items():
            sun_row = sun_by_mmdd.get(date_key[4:8])
            if sun_row is None:
                continue
            for column in value_columns:
                merged_row[column] = sun_row[column]
        logger.info(f"Fusionne: {sun_path.name} (reporte sur toutes les annees)")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / output_name
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for date_key in sorted(rows):
            writer.writerow({"Date": date_key, **rows[date_key]})

    logger.info(f"Ecrit: {output_path} ({len(rows)} jours, {len(fieldnames)} colonnes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed-dir", type=Path, default=DEFAULT_PROCESSED_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--output", default=DEFAULT_OUTPUT_NAME)
    args = parser.parse_args()
    merge(args.processed_dir, args.output_dir, args.output)
