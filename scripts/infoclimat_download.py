"""Download day-by-day climatology data from infoclimat.fr for a weather station,
for a range of years, and export it to CSV.

The yearly "details" page (e.g. the one a user browses to look at the year's
charts) embeds the full daily series as JSON inside inline
`new Highcharts.Chart({...})` calls - one chart per metric (daily extreme
temperatures, daily mean temperature, daily precipitation). That JSON is what
feeds the interactive tooltips when hovering the chart in a browser, and it
covers the whole year in a single page load, so no per-day scraping is needed.

Usage (from repo root):
    python scripts/infoclimat_download.py                          # current year only, Chambery
                                                                   # (in January: last year too, for December)
    python scripts/infoclimat_download.py --start-year 2022        # full backfill 2022 -> current year
    python scripts/infoclimat_download.py --start-year 2024 --end-year 2025
    python scripts/infoclimat_download.py --station-slug paris-montsouris --station-id 07156

Writes one CSV per year to data/raw/infoclimat_<station-id>_<year>_byday.csv
(columns: Date=YYYYMMDD, TempMax, TempMin, TempMoy, Precip), then merges every
data/raw/infoclimat_<station-id>_*_byday.csv (all years, not just the ones
just downloaded) into a single data/processed/CLI_ByDay.csv (columns prefixed
CLI_ for the dataset merge in scripts/final_processing.py).
"""

import argparse
import csv
import json
import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = REPO_ROOT / "data" / "raw"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
MERGED_CSV_NAME = "CLI_ByDay.csv"
RAW_FIELDNAMES = ["Date", "TempMax", "TempMin", "TempMoy", "Precip"]
MERGED_FIELDNAMES = ["Date", "CLI_TempMax", "CLI_TempMin", "CLI_TempMoy", "CLI_Precip"]
LOG_DIR = REPO_ROOT / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("infoclimat_download")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "infoclimat_download.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

DEFAULT_STATION_SLUG = "chambery-aix-les-bains"
DEFAULT_STATION_ID = "07491"

URL_TEMPLATE = "https://www.infoclimat.fr/climatologie/annee/{year}/{station_slug}/details/{station_id}.html"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; joule data import script)"}

# chart title substring -> (output column, series name or name-prefix to read)
CHART_SERIES = [
    ("Temperatures extremes", "TempMax", "Température maximale", False),
    ("Temperatures extremes", "TempMin", "Température minimale", False),
    ("Temperatures moyennes", "TempMoy", "Température moyenne", True),
    ("Precipitations en", "Precip", "Précipitations journalières", False),
]


def strip_accents(text: str) -> str:
    return (
        text.replace("é", "e").replace("è", "e").replace("ê", "e")
        .replace("à", "a").replace("â", "a")
    )


def extract_highcharts_objects(page_html: str) -> list[dict]:
    """Pull every `new Highcharts.Chart({...})` payload out of the page and
    parse it as JSON. A couple of charts embed JS formatter functions (not
    valid JSON) - those are skipped, we only need the ones with raw series
    data."""
    marker = "new Highcharts.Chart("
    charts = []
    start = 0
    while True:
        idx = page_html.find(marker, start)
        if idx == -1:
            break
        i = page_html.index("{", idx + len(marker))
        depth, in_str, escaped, j = 0, False, False, i
        while j < len(page_html):
            c = page_html[j]
            if in_str:
                if escaped:
                    escaped = False
                elif c == "\\":
                    escaped = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        start = j
        try:
            charts.append(json.loads(page_html[i:j]))
        except json.JSONDecodeError:
            continue
    return charts


def epoch_ms_to_date_str(epoch_ms: int) -> str:
    # Points are stamped at 23:00 UTC (= midnight Paris time) marking the end
    # of the day they describe, so the UTC calendar date - not the Paris-local
    # one, which would roll over to the next day - is the correct day label.
    dt = datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc)
    return dt.strftime("%Y%m%d")


def parse_year_html(page_html: str) -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    for chart in extract_highcharts_objects(page_html):
        title = strip_accents(chart.get("title", {}).get("text", ""))
        for title_match, column, series_name, is_prefix in CHART_SERIES:
            if title_match not in title:
                continue
            for series in chart.get("series", []):
                name = series.get("name", "")
                matches = name.startswith(series_name) if is_prefix else name == series_name
                if not matches:
                    continue
                for point in series.get("data", []):
                    if point.get("y") is None:
                        continue
                    date_key = epoch_ms_to_date_str(point["x"])
                    rows.setdefault(date_key, {})[column] = str(point["y"])
    return rows


def download(station_slug: str, station_id: str, start_year: int, end_year: int) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    for year in range(start_year, end_year + 1):
        url = URL_TEMPLATE.format(year=year, station_slug=station_slug, station_id=station_id)
        response = requests.get(url, headers=HEADERS, timeout=30)
        response.raise_for_status()

        rows = parse_year_html(response.text)
        if not rows:
            logger.info(f"Aucune donnee journaliere trouvee pour {year}, page ignoree.")
            continue

        csv_path = RAW_DIR / f"infoclimat_{station_id}_{year}_byday.csv"
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=RAW_FIELDNAMES)
            writer.writeheader()
            for date_key in sorted(rows):
                writer.writerow({"Date": date_key, **rows[date_key]})
        logger.info(f"Ecrit: {csv_path} ({len(rows)} jours)")

    merge_years(station_id)


def merge_years(station_id: str) -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    rows: dict[str, dict[str, str]] = {}
    for csv_path in sorted(RAW_DIR.glob(f"infoclimat_{station_id}_*_byday.csv")):
        with open(csv_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                rows[row["Date"]] = row

    merged_path = PROCESSED_DIR / MERGED_CSV_NAME
    with open(merged_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=MERGED_FIELDNAMES)
        writer.writeheader()
        for date_key in sorted(rows):
            writer.writerow({"Date": date_key, **{f"CLI_{k}": v for k, v in rows[date_key].items() if k != "Date"}})
    logger.info(f"Fusionne: {merged_path} ({len(rows)} jours)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--station-slug", default=DEFAULT_STATION_SLUG)
    parser.add_argument("--station-id", default=DEFAULT_STATION_ID)
    # Year of the previous month's first day: the current year, except in January where it's last
    # year, so a run on the 1st of the month always covers the month that just ended.
    parser.add_argument(
        "--start-year", type=int, default=(date.today().replace(day=1) - timedelta(days=1)).year
    )
    parser.add_argument("--end-year", type=int, default=date.today().year)
    args = parser.parse_args()

    download(args.station_slug, args.station_id, args.start_year, args.end_year)
