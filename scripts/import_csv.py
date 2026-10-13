"""Load data/dataset/Transformation-ByDay.csv into the daily_readings table.

Self-adapting: any CSV column without a matching daily_readings column (match
is case-insensitive, e.g. "Conso" -> "conso") gets the column added on the fly
(REAL if every non-empty value parses as a float, TEXT otherwise).
Existing values are never overwritten - a row is inserted if its date is new,
and only the still-NULL columns of an existing date are filled in.

Usage (from repo root):
    python scripts/import_csv.py [path/to/Transformation-ByDay.csv]

Defaults to ./data/dataset/Transformation-ByDay.csv relative to the repo root.
"""

import csv
import logging
import sys
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import inspect as sa_inspect, text
from sqlalchemy.engine import Connection

REPO_ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = REPO_ROOT / "logs"

sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.core.db import Base, engine

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("import_csv")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "import_csv.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

TABLE = "daily_readings"
DATE_COLUMN = "Date"
NUMERIC_TYPES = {"double precision", "real", "numeric", "integer", "bigint", "float", "double"}
MISSING_VALUES = {"", "NA"}


def column_types(conn: Connection) -> dict[str, str]:
    inspector = sa_inspect(conn)
    cols = inspector.get_columns(TABLE)
    return {col["name"]: str(col["type"]).lower() for col in cols}


def is_floatable(value: str) -> bool:
    try:
        float(value)
        return True
    except ValueError:
        return False


def ensure_columns(conn: Connection, fieldnames: list[str], rows: list[dict[str, str]]) -> dict[str, str]:
    """Add any missing CSV column to the table; return csv column -> db column."""
    types = column_types(conn)
    mapping = {}
    for csv_column in fieldnames:
        if csv_column == DATE_COLUMN:
            continue
        db_column = csv_column.lower()
        mapping[csv_column] = db_column
        if db_column in types:
            continue
        samples = [row[csv_column] for row in rows if row[csv_column] not in MISSING_VALUES]
        sql_type = "REAL" if samples and all(is_floatable(v) for v in samples) else "TEXT"
        conn.execute(text(f'ALTER TABLE {TABLE} ADD COLUMN "{db_column}" {sql_type}'))
        types[db_column] = sql_type.lower()
        logger.info(f"Colonne ajoutee: {db_column} ({sql_type})")
    return mapping


def cast_value(data_type: str, raw_value: str) -> float | str | None:
    if raw_value in MISSING_VALUES:
        return None
    return float(raw_value) if data_type in NUMERIC_TYPES else raw_value


def upsert_rows(
    conn: Connection,
    mapping: dict[str, str],
    types: dict[str, str],
    rows: list[dict[str, str]],
) -> int:
    db_columns = ["date", *mapping.values()]

    set_clause = ", ".join(
        f'"{c}" = COALESCE("{c}", excluded."{c}")' for c in db_columns if c != "date"
    )
    columns_sql = ", ".join(f'"{c}"' for c in db_columns)
    placeholders = ", ".join(f":{c}" for c in db_columns)
    stmt = text(
        f"INSERT INTO {TABLE} ({columns_sql}) VALUES ({placeholders}) "
        f"ON CONFLICT (date) DO UPDATE SET {set_clause}"
    )

    params = []
    for row in rows:
        d: date = datetime.strptime(row[DATE_COLUMN], "%Y%m%d").date()
        values: dict[str, object] = {"date": d}
        for csv_column, db_column in mapping.items():
            values[db_column] = cast_value(types[db_column], row[csv_column])
        params.append(values)

    conn.execute(stmt, params)
    return len(params)


def main(csv_path: Path) -> None:
    Base.metadata.create_all(bind=engine)

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    with engine.begin() as conn:
        mapping = ensure_columns(conn, fieldnames, rows)
        types = column_types(conn)
        count = upsert_rows(conn, mapping, types, rows)

    logger.info(f"Imported {count} daily readings from {csv_path.name}.")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        target_path = Path(sys.argv[1])
    elif Path("/data/dataset/Transformation-ByDay.csv").exists():
        target_path = Path("/data/dataset/Transformation-ByDay.csv")
    else:
        target_path = REPO_ROOT / "data" / "dataset" / "Transformation-ByDay.csv"
    main(target_path)
