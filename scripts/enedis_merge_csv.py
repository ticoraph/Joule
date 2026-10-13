"""Merge freshly converted Enedis CSVs (scripts/enedis_xlsx_to_csv.py output)
into the historical data/processed/ENE_ByDay.csv file, without duplicating
days.

For a given day, the columns fed by the new export replace the existing
values for that same day; columns/days not present in the new export are
left untouched.

Usage (from repo root):
    python scripts/enedis_merge_csv.py [--raw-dir data/raw] [--processed-dir data/processed]
"""

import argparse
import csv
import logging
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw"
DEFAULT_PROCESSED_DIR = REPO_ROOT / "data" / "processed"
MERGED_CSV_NAME = "ENE_ByDay.csv"
LOG_DIR = REPO_ROOT / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("enedis_merge_csv")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "enedis_merge_csv.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())


# raw csv prefix -> {raw column: merged column}
TARGETS = {
    "energy": {"Conso": "ENE_Conso"},
    "index": {
        "Index_Total": "ENE_Index_Total",
        "Index_HP": "ENE_Index_HP",
        "Index_HC": "ENE_Index_HC",
    },
    "powermax": {"PMax_Hour": "ENE_PMax_Hour", "PMax": "ENE_PMax"},
}

FIELDNAMES = ["Date", *(col for mapping in TARGETS.values() for col in mapping.values())]

# merged column -> decimal places to round to
ROUNDING = {
    "ENE_Conso": 0,
    "ENE_Index_Total": 0,
    "ENE_Index_HP": 0,
    "ENE_Index_HC": 0,
    "ENE_PMax": 1,
}


def _round_value(merged_column: str, value: str) -> str:
    ndigits = ROUNDING.get(merged_column)
    if ndigits is None or value == "":
        return value
    rounded = round(float(value), ndigits)
    return str(int(rounded)) if ndigits == 0 else str(rounded)


def merge_into(rows: dict[str, dict[str, str]], new_path: Path, column_map: dict[str, str]) -> int:
    updated = 0
    with open(new_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            target_row = rows.setdefault(row["Date"], {})
            for raw_column, merged_column in column_map.items():
                target_row[merged_column] = _round_value(merged_column, row[raw_column])
            updated += 1
    return updated


def latest_file(raw_dir: Path, prefix: str) -> Path:
    matches = sorted(raw_dir.glob(f"{prefix}_*.csv"))
    if not matches:
        raise SystemExit(f"Aucun fichier {prefix}_*.csv dans {raw_dir}")
    return matches[-1]


def main(raw_dir: Path, processed_dir: Path) -> None:
    target_path = processed_dir / MERGED_CSV_NAME

    rows: dict[str, dict[str, str]] = {}
    if target_path.exists():
        with open(target_path, newline="", encoding="utf-8") as f:
            rows = {row["Date"]: row for row in csv.DictReader(f)}

    for prefix, column_map in TARGETS.items():
        new_csv = latest_file(raw_dir, prefix)
        count = merge_into(rows, new_csv, column_map)
        logger.info(f"{new_csv.name} -> {MERGED_CSV_NAME} ({count} jours fusionnes)")

    processed_dir.mkdir(parents=True, exist_ok=True)
    with open(target_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for date_key in sorted(rows):
            writer.writerow({"Date": date_key, **rows[date_key]})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--processed-dir", type=Path, default=DEFAULT_PROCESSED_DIR)
    args = parser.parse_args()
    main(args.raw_dir, args.processed_dir)
