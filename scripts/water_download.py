"""Automate downloading the water meter consumption history from
eauenligne.grandchambery.fr (Eau du Grand Chambéry's "espace abonné" portal).

The site requires authentication. Rather than storing credentials, this script
saves a Playwright storage_state (cookies/local storage) after a manual login
and reuses it for subsequent automated runs - same approach as
scripts/enedis_download.py.

The "Consommations" page shows a readings-history table (#tableReleve, one row
per meter reading: Date, Référence équipement, Estimée/Relevée, Origine,
Index, Nom) rather than offering a single bulk export. There's no
download/export button, so this script reads the table's full dataset
straight from its jQuery DataTables instance (confirmed via
`$('#tableReleve').DataTable().rows().data()`, which returns every row
regardless of the on-screen pagination) and writes it to CSV.

Usage (from repo root):
    python scripts/water_download.py --login         # one-time manual login, saves session
    python scripts/water_download.py                 # scrapes the readings table to data/raw/
    python scripts/water_download.py --inspect        # opens the authenticated page + Playwright Inspector

Writes data/raw/water_YYYYMMDD_HHMMSS.csv (columns: Date, Reference_equipement,
Estimee_Relevee, Origine, Index, Conso, Nom). Conso is the consumption (m3)
since the previous reading, derived from consecutive Index values - the
meter-installation row (Index 0) is dropped, and the oldest row overall has
its Conso left blank since there's no earlier reading to diff against. The
portal only retains the 5 most recent readings, so older yearly readings
(2014-2020) are backfilled manually - see MANUAL_READINGS below.
"""

import argparse
import csv
import json
import logging
import os
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

# Subscription id is account-specific: set WATER_PORTAL_URL (e.g. in private/ or the shell), format
# https://eauenligne.grandchambery.fr/Portail/fr-FR/Usager/Abonnement/Consommations/<subscription_id>
URL = os.environ.get("WATER_PORTAL_URL", "")


def portal_url() -> str:
    if not URL:
        raise SystemExit("WATER_PORTAL_URL non défini (voir le commentaire au-dessus de URL).")
    return URL

REPO_ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = REPO_ROOT / "private" / "eauenligne_state.json"
RAW_DIR = REPO_ROOT / "data" / "raw"
LOG_DIR = REPO_ROOT / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("water_download")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "water_download.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

TABLE_SELECTOR = "#tableReleve"
RAW_FIELDNAMES = ["Date", "Reference_equipement", "Estimee_Relevee", "Origine", "Index", "Nom"]
CSV_FIELDNAMES = ["Date", "Reference_equipement", "Estimee_Relevee", "Origine", "Index", "Conso", "Nom"]

# The portal only keeps the 5 most recent readings (since the meter swap in
# 2023). These older yearly readings predate that window and aren't
# available to scrape, so they're entered manually here to extend the
# history back to 2014. Newest-first, to match the order scraped rows come
# back in - prepended onto the scraped list before Conso is computed so the
# diff chain is continuous across the manual/scraped boundary.
# Manual readings are personal data, so they live in the gitignored private/water_manual_readings.json
# (a list of {"Date": "DD/MM/YYYY", "Index": "<m3 index>"}, newest-first); missing file = no backfill.
MANUAL_READINGS_PATH = REPO_ROOT / "private" / "water_manual_readings.json"
MANUAL_READINGS = (
    json.loads(MANUAL_READINGS_PATH.read_text(encoding="utf-8")) if MANUAL_READINGS_PATH.exists() else []
)

# Pulls the full dataset straight from the jQuery DataTables instance rather
# than scraping rendered <tr> elements: dt.rows().data() returns every row
# regardless of the on-screen pagination, and the underlying row arrays have
# more columns than the visible table (a hidden internal id, etc.) - slice
# down to the documented columns.
SCRAPE_JS = """
() => {
    const dt = jQuery('%s').DataTable();
    return dt.rows().data().toArray().map(row => row.slice(0, %d));
}
""" % (TABLE_SELECTOR, len(RAW_FIELDNAMES))


def login() -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(portal_url())
        input("Connectez-vous manuellement dans le navigateur, puis appuyez sur Entree ici...")
        context.storage_state(path=str(STATE_PATH))
        browser.close()
    logger.info(f"Session sauvegardee dans {STATE_PATH}")


def scrape_readings(page) -> list[dict]:
    """Scrape the readings table. Rows come back newest-first.

    The row with Index "0" is the new meter's installation record, not a
    real reading, so it's dropped here.
    """
    page.wait_for_selector(TABLE_SELECTOR)
    rows = page.evaluate(SCRAPE_JS)
    return [dict(zip(RAW_FIELDNAMES, row)) for row in rows if row[4] != "0"]


def with_conso(readings: list[dict]) -> list[dict]:
    """Prepend the manual historical readings and derive a Conso (m3
    consumed since the previous reading) column from consecutive Index
    values. The oldest row overall has no earlier reading to diff against,
    so its Conso is left blank rather than guessed."""
    readings = readings + [dict(r, Reference_equipement=os.environ.get("WATER_METER_REF", ""), Estimee_Relevee="Relevée", Origine="", Nom="Consommation EAU") for r in MANUAL_READINGS]

    for i, reading in enumerate(readings):
        if i + 1 < len(readings):
            reading["Conso"] = str(int(reading["Index"]) - int(readings[i + 1]["Index"]))
        else:
            reading["Conso"] = ""

    return readings


def download() -> None:
    if not STATE_PATH.exists():
        raise SystemExit(
            f"{STATE_PATH} introuvable. Lancez d'abord: python scripts/water_download.py --login"
        )

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(storage_state=str(STATE_PATH))
        page = context.new_page()
        page.goto(portal_url())
        page.wait_for_load_state("networkidle")

        try:
            readings = scrape_readings(page)
            if not readings:
                raise RuntimeError("Tableau des releves trouve mais vide")
            readings = with_conso(readings)
        except Exception:
            debug_path = RAW_DIR.parent / "debug_failure_water.png"
            page.screenshot(path=str(debug_path))
            logger.exception(f"Echec. Capture: {debug_path}")
            browser.close()
            raise

        browser.close()

    dest = RAW_DIR / f"water_{timestamp}.csv"
    with open(dest, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDNAMES)
        writer.writeheader()
        writer.writerows(readings)
    logger.info(f"Telecharge: {dest} ({len(readings)} releves)")


def inspect() -> None:
    """Open the authenticated page and pause with the Playwright Inspector
    so the table/selectors can be checked manually if scraping fails."""
    if not STATE_PATH.exists():
        raise SystemExit(
            f"{STATE_PATH} introuvable. Lancez d'abord: python scripts/water_download.py --login"
        )
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(storage_state=str(STATE_PATH))
        page = context.new_page()
        page.goto(portal_url())
        page.pause()
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--login", action="store_true", help="Login manuel et sauvegarde de la session")
    parser.add_argument(
        "--inspect", action="store_true", help="Ouvre la page authentifiee avec l'inspecteur Playwright"
    )
    args = parser.parse_args()

    if args.login:
        login()
    elif args.inspect:
        inspect()
    else:
        download()
