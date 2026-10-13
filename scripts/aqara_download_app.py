"""Extract per-day temperature and smart-plug power readings directly from
the Aqara Home app's local cache - no mitmproxy/auth needed.

Aqara Home on macOS is a sandboxed iOS app (bundle id
com.lumiunited.pre.homekit), so its real data directory isn't under
~/Library/Application Support/ or a container named after the bundle id -
it's ~/Library/Containers/<random GUID>/Data/. Inside, Library/Database/
chartData.sqlite has one table per device (named `lumi<deviceId>`, e.g.
`lumiXXXXXXXXXXXXXX` for did `lumi.XXXXXXXXXXXXXX`) with columns
(timeInterval ms epoch, attr, value). Temperature is attr "0.1.85", value in
centi-degrees C (divide by 100). Smart-plug instantaneous power is attr
"0.12.85", value already in watts. This is the exact same data the app's own
charts read - it's a rolling cache of whatever ranges have been viewed in the
app, not the full server history, so the more time ranges have been opened
in the app's charts, the more days end up in this script's output.

Flattens every (device, day) into a daily value: temperature sensors are
averaged (degrees C), smart plugs have their instantaneous-watt samples
trapezoidal-integrated over the day into a daily energy total (kWh, columns
suffixed _kWh). Merges into data/processed/AQR_ByDay.csv (columns
prefixed AQR_, one per device), the same way scripts/enedis_merge_csv.py
merges Enedis exports: a day present in the cache overwrites that day's
value, other days are left untouched - so re-running after opening more
charts in the app is safe.

Gap filling from monthly totals: the cache often misses whole days for the
smart plugs (ranges never opened in the app), but the app's own stats screen
shows each plug's monthly total. Those totals are typed by hand into
data/processed/AQR_ByDay_Monthly.csv (one row per month, Month=YYYY-MM, one
column per AQR_Prise*_kWh, blank = unknown). For every plug/month with a
total, the missing days get (monthly total - sum of the measured days) / number
of missing days, rounded down so the month never exceeds the total (0 if the
measured days already reach it). Only fully elapsed months are filled.

Measured values only are accumulated in data/raw/AQR_ByDay_real.csv;
data/processed/AQR_ByDay.csv is rebuilt from it + the estimates on every run,
so later real data (after opening more charts in the app) replaces estimates
and editing a monthly total just re-spreads that month.

Usage (from repo root, with the Aqara Home app having been opened at least
once so its container exists):
    python scripts/aqara_download_app.py
"""

import argparse
import csv
import json
import logging
import sqlite3
from collections import defaultdict
import calendar
import math
from datetime import date, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
LOG_DIR = REPO_ROOT / "logs"
RAW_DIR = REPO_ROOT / "data" / "raw"
PROCESSED_CSV_NAME = "AQR_ByDay.csv"
REAL_CSV = RAW_DIR / "AQR_ByDay_real.csv"
MONTHLY_CSV = PROCESSED_DIR / "AQR_ByDay_Monthly.csv"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("aqara_download_app")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "aqara_download_app.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

# Le cache de l'app remonte parfois a des annees anterieures a l'installation
# reelle des capteurs (fausses lectures issues d'un ancien device reutilise) ;
# on ignore tout ce qui precede cette date.
MIN_DATE_KEY = "20260101"

BUNDLE_ID = "com.lumiunited.pre.homekit"
TEMPERATURE_ATTR = "0.1.85"
POWER_ATTR = "0.12.85"

# Device ids are specific to one Aqara account, so they live in the gitignored
# private/aqara_devices.json (see scripts/aqara_devices.example.json for the shape):
#   "temperature": did -> AQR_* column, from the "Temperature and humidity sensor" devices
#                  (model lumi.weather.v1). Value is centi-degrees C, divided by 100.
#   "power":       did -> AQR_*_kWh column, from the smart plugs. Raw value is instantaneous
#                  power in watts; trapezoidal integration over the day turns it into a daily
#                  energy total in kWh (matching the ECO_*_kWh convention).
DEVICES_CONFIG = REPO_ROOT / "private" / "aqara_devices.json"
if not DEVICES_CONFIG.exists():
    raise SystemExit(
        f"{DEVICES_CONFIG} introuvable - copier scripts/aqara_devices.example.json "
        "et y renseigner les 'did' des appareils Aqara."
    )
_devices = json.loads(DEVICES_CONFIG.read_text(encoding="utf-8"))
TEMPERATURE_DEVICE_COLUMNS: dict[str, str] = _devices["temperature"]
POWER_DEVICE_COLUMNS: dict[str, str] = _devices["power"]

DEVICE_ATTRS = {
    **{did: TEMPERATURE_ATTR for did in TEMPERATURE_DEVICE_COLUMNS},
    **{did: POWER_ATTR for did in POWER_DEVICE_COLUMNS},
}
DEVICE_SCALES = {
    **{did: 100 for did in TEMPERATURE_DEVICE_COLUMNS},
    **{did: 1 for did in POWER_DEVICE_COLUMNS},
}
DEVICE_COLUMNS = {**TEMPERATURE_DEVICE_COLUMNS, **POWER_DEVICE_COLUMNS}
FIELDNAMES = ["Date", *DEVICE_COLUMNS.values()]


def find_chart_db() -> Path:
    containers_dir = Path.home() / "Library" / "Containers"
    for db_path in containers_dir.glob("*/Data/Library/Database/chartData.sqlite"):
        data_dir = db_path.parents[2]
        if (data_dir / "Library" / "Caches" / BUNDLE_ID).exists():
            return db_path
    raise SystemExit(
        f"chartData.sqlite introuvable sous {containers_dir} - "
        "l'app Aqara Home a-t-elle déjà été lancée sur ce Mac ?"
    )


def iter_points(db_path: Path):
    """Yield (did, timestamp_ms, value) for every cached reading (temperature
    in degrees C, power in watts) of every known device."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        for did, column in DEVICE_COLUMNS.items():
            table = did.replace(".", "")
            try:
                rows = con.execute(
                    f'SELECT timeInterval, value FROM "{table}" WHERE attr = ?', (DEVICE_ATTRS[did],)
                ).fetchall()
            except sqlite3.OperationalError:
                logger.info(f"  (pas de table pour {column} / {did} - jamais ouvert dans l'app ?)")
                continue
            scale = DEVICE_SCALES[did]
            for timestamp_ms, value in rows:
                try:
                    yield did, int(timestamp_ms), float(value) / scale
                except (TypeError, ValueError):
                    continue
    finally:
        con.close()


def points_by_day(db_path: Path) -> dict[str, dict[str, list[tuple[int, float]]]]:
    by_day: dict[str, dict[str, list[tuple[int, float]]]] = defaultdict(lambda: defaultdict(list))
    for did, timestamp_ms, value in iter_points(db_path):
        date_key = datetime.fromtimestamp(timestamp_ms / 1000).strftime("%Y%m%d")
        if date_key < MIN_DATE_KEY:
            continue
        by_day[date_key][DEVICE_COLUMNS[did]].append((timestamp_ms, value))
    return by_day


def integrate_watts_to_kwh(samples: list[tuple[int, float]]) -> float:
    """Trapezoidal-integrate instantaneous watt samples over the day into
    kWh. Gaps over an hour (sensor offline) aren't bridged."""
    samples = sorted(samples)
    energy_ws = 0.0
    for (t1, v1), (t2, v2) in zip(samples, samples[1:]):
        dt_s = (t2 - t1) / 1000
        if dt_s > 3600:
            continue
        energy_ws += (v1 + v2) / 2 * dt_s
    return energy_ws / 3600 / 1000


def read_rows(path: Path) -> dict[str, dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return {row["Date"]: row for row in csv.DictReader(f)}


def write_rows(path: Path, rows: dict[str, dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for date_key in sorted(rows):
            writer.writerow(rows[date_key])


def read_monthly_totals() -> dict[tuple[str, str], float]:
    """(YYYY-MM, column) -> monthly kWh total, from AQR_ByDay_Monthly.csv
    (blank cells skipped, decimal comma accepted)."""
    if not MONTHLY_CSV.exists():
        return {}
    totals = {}
    with MONTHLY_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            for column in POWER_DEVICE_COLUMNS.values():
                value = (row.get(column) or "").strip().replace(",", ".")
                if value:
                    totals[(row["Month"].strip(), column)] = float(value)
    return totals


def fill_from_monthly_totals(real_rows: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    """Return a copy of real_rows where each plug's missing days, in months
    with a known total, are spread from (total - measured)."""
    rows = {date_key: dict(row) for date_key, row in real_rows.items()}
    first_of_this_month = date.today().replace(day=1)

    for (month, column), total in sorted(read_monthly_totals().items()):
        year, month_num = map(int, month.split("-"))
        if date(year, month_num, 1) >= first_of_this_month:
            logger.info(f"  {month} {column}: mois pas encore termine, ignore")
            continue
        days = [
            date(year, month_num, day).strftime("%Y%m%d")
            for day in range(1, calendar.monthrange(year, month_num)[1] + 1)
        ]
        measured = [float(rows[d][column]) for d in days if rows.get(d, {}).get(column)]
        missing = [d for d in days if not rows.get(d, {}).get(column)]
        if not missing:
            continue

        remainder = total - sum(measured)
        # rounded down so the filled month never exceeds the monthly total
        per_day = max(0.0, math.floor(remainder / len(missing) * 1000) / 1000)
        if remainder <= 0:
            logger.warning(
                f"  {month} {column}: les jours mesures ({sum(measured):.3f} kWh) atteignent deja "
                f"le total mensuel ({total} kWh) - {len(missing)} jour(s) manquant(s) mis a 0"
            )
        for d in missing:
            rows.setdefault(d, {"Date": d})[column] = f"{per_day:.3f}"
        logger.info(
            f"  {month} {column}: {len(missing)} jour(s) estime(s) a {per_day:.3f} kWh "
            f"(total {total} - mesure {sum(measured):.3f})"
        )
    return rows


def main(db_path: Path) -> None:
    by_day = points_by_day(db_path)

    target_path = PROCESSED_DIR / PROCESSED_CSV_NAME
    rows: dict[str, dict[str, str]] = {}
    if REAL_CSV.exists():
        rows = read_rows(REAL_CSV)
    elif target_path.exists():
        # first run since gap filling was added: AQR_ByDay.csv only holds measured values so far
        rows = read_rows(target_path)

    power_columns = set(POWER_DEVICE_COLUMNS.values())
    for date_key, columns in by_day.items():
        row = rows.setdefault(date_key, {"Date": date_key})
        for column, samples in columns.items():
            if column in power_columns:
                row[column] = f"{integrate_watts_to_kwh(samples):.3f}"
            else:
                values = [v for _, v in samples]
                row[column] = f"{sum(values) / len(values):.2f}"

    write_rows(REAL_CSV, rows)
    logger.info(f"Merged {len(by_day)} day(s) from {db_path} into {REAL_CSV}")

    write_rows(target_path, fill_from_monthly_totals(rows))
    logger.info(f"Ecrit: {target_path} (mesures + jours estimes depuis {MONTHLY_CSV.name})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=None, help="path to chartData.sqlite (auto-detected if omitted)")
    args = parser.parse_args()
    main(args.db or find_chart_db())
