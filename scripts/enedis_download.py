"""Automate downloading consumption .xlsx exports from mon-compte-particulier.enedis.fr.

Usage (from repo root):
    python scripts/enedis_download.py --login         # one-time manual login, saves session
    python scripts/enedis_download.py                 # downloads the 3 exports for the current year
    python scripts/enedis_download.py --year 2025      # backfill a specific past year instead

The site requires authentication. Rather than storing credentials, this script
saves a Playwright storage_state (cookies/local storage) after a manual login
and reuses it for subsequent automated runs.
"""

import argparse
import logging
import re
import time
from datetime import datetime, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "https://mon-compte-particulier.enedis.fr/visualiser-vos-mesures-consommation"

REPO_ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = REPO_ROOT / "private" / "enedis_state.json"
PROFILE_DIR = REPO_ROOT / "private" / "enedis_chrome_profile"
RAW_DIR = REPO_ROOT / "data" / "raw"
LOG_DIR = REPO_ROOT / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("enedis_download")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "enedis_download.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

# (label, prefix, period_mode): the export is bound to the selected period,
# which defaults to the last 30 days for all three metrics.
# - "year_tab": Energie/Puissance maximale have a Jour/Semaine/Mois/Année
#   tab bar; clicking "Année" widens the period to the full year.
# - "date_range": Index has no such tabs, just a single date-range field;
#   the range must be set explicitly via the day-granularity calendar.
METRICS = [
    ("Energie (kWh)", "energy", "year_tab"),
    ("Index (kWh)", "index", "date_range"),
    ("Puissance maximale (kVA)", "powermax", "year_tab"),
]

# The select/download widgets live inside a cross-origin iframe embedded in
# the page, not in the top-level document. page.locator() only searches the
# main frame, so every interaction below must go through this frame_locator.
MEASURES_FRAME_SELECTOR = "iframe[src*='frontend-mes-mesures-prm-cloud.enedis.fr']"

# Enedis runs bot-detection (Datadome) that flags Playwright's bundled Chromium
# (navigator.webdriver, missing chrome.runtime, etc.). Launching the real,
# locally-installed Chrome and hiding the automation flag avoids the
# "Browser check failed" page for this kind of legitimate personal-account use.
LAUNCH_KWARGS = {
    "channel": "chrome",
    "args": ["--disable-blink-features=AutomationControlled"],
}


def login() -> None:
    # A persistent user-data-dir (rather than an ephemeral new_context()) makes
    # Chrome behave like a normal, regularly-used browser profile - notably, it
    # offers to save the password, which a throwaway context never does.
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(PROFILE_DIR), headless=False, **LAUNCH_KWARGS
        )
        page = context.new_page()
        page.goto(URL)
        input("Connectez-vous manuellement dans le navigateur, puis appuyez sur Entree ici...")
        context.storage_state(path=str(STATE_PATH))
        context.close()
    logger.info("Session sauvegardee dans %s", STATE_PATH)


# The trigger span always shows one of these three labels (whichever metric
# is currently selected). Matching on that text is more robust than the
# "sds-select_value" class, which didn't match the actual DOM on this build.
TRIGGER_PATTERN = re.compile(
    r"^\s*(" + "|".join(re.escape(label) for label, _, _ in METRICS) + r")\s*$"
)


def select_metric(frame, label: str) -> None:
    # The option click was observed to occasionally no-op (dropdown closes
    # without the trigger's displayed label actually changing), which
    # silently downloads whatever metric was already selected under the new
    # metric's filename. Retry until the trigger text confirms the switch.
    exact_trigger = frame.get_by_text(re.compile(rf"^\s*{re.escape(label)}\s*$"))
    for attempt in range(4):
        if exact_trigger.count() > 0 and exact_trigger.first.is_visible():
            return

        frame.get_by_text(TRIGGER_PATTERN).first.click()
        option = frame.get_by_role("option", name=label, exact=True)
        if option.count() == 0:
            option = frame.get_by_text(label, exact=True)
        option.first.click()
        time.sleep(0.5 + attempt * 0.5)
    else:
        if not (exact_trigger.count() > 0 and exact_trigger.first.is_visible()):
            raise RuntimeError(f"Impossible de selectionner la metrique {label}")


def select_year_view(page, frame, year: str) -> None:
    tab = frame.get_by_role("tab", name="Année", exact=True)
    if tab.count() == 0:
        tab = frame.get_by_text("Année", exact=True)
    tab.first.click()

    # Clicking "Année" resets the period to some previously remembered year
    # (not necessarily the target one), so the year must be picked explicitly
    # via the date-range picker, opened through its dedicated toggle button.
    # The CDK overlay is occasionally still settling/animating when the year
    # button is clicked, which makes Playwright hit a stray backdrop/header
    # element instead - retry with growing waits rather than failing outright.
    year_button = frame.get_by_role("button", name=year, exact=True)
    last_error = None
    for attempt in range(4):
        try:
            if not year_button.first.is_visible():
                frame.get_by_role("button", name="Ouvrir le calendrier").first.click()
            time.sleep(0.5 + attempt * 0.5)
            year_button.first.click(timeout=5000)
            break
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)
    else:
        raise RuntimeError(f"Impossible de selectionner l'annee {year}") from last_error

    dismiss_calendar_overlay(page)


# Month abbreviations as shown by the Enedis date-picker's month view. A
# couple of candidates are listed per month since it's unclear from a single
# observation (JANV., JUIL.) whether accented months (FÉVR., AOÛT, DÉC.) are
# rendered with or without their accent - try both.
MONTH_ABBR_CANDIDATES = {
    1: ["JANV."],
    2: ["FÉVR.", "FEVR."],
    3: ["MARS"],
    4: ["AVR."],
    5: ["MAI"],
    6: ["JUIN"],
    7: ["JUIL."],
    8: ["AOÛT", "AOUT"],
    9: ["SEPT."],
    10: ["OCT."],
    11: ["NOV."],
    12: ["DÉC.", "DEC."],
}


def dismiss_calendar_overlay(page) -> None:
    # Selecting a date leaves the calendar dropdown open, and with it a
    # transparent cdk-overlay-backdrop covering the whole page that swallows
    # every later click (e.g. on "Télécharger le .xlsx"). Closing it here
    # (Escape, then a fallback click outside) ensures the backdrop detaches
    # before the caller interacts with anything else on the page.
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    backdrop = page.locator(".cdk-overlay-backdrop")
    try:
        backdrop.first.wait_for(state="detached", timeout=3000)
    except Exception:
        # Escape didn't close it - click the backdrop itself to dismiss it.
        try:
            backdrop.first.click(timeout=1000)
            backdrop.first.wait_for(state="detached", timeout=3000)
        except Exception:
            pass

    # Selecting the date triggers an async reload of the chart/export data.
    # Clicking "Télécharger le .xlsx" right away (before that reload settles)
    # was exporting whatever period was loaded previously (the default
    # last-30-days view) instead of the requested one - wait for the network
    # activity from the reload to quiet down before returning control to the
    # caller.
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    time.sleep(1)


def select_index_date_range(page, frame, year: str) -> None:
    """Index (kWh) has no Jour/Semaine/Mois/Année tabs, just a date-range
    field defaulting to the last 30 days. Set it explicitly to span the
    target year (Jan 1 through yesterday for the current year, Jan 1
    through Dec 31 for a past year) by driving the day-granularity
    calendar: open it, jump to the start date, then repeat for the end
    date. Sequence captured via Playwright Inspector's "Pick locator"."""
    frame.get_by_role("button", name="Ouvrir le calendrier").first.click()

    def open_month_year_picker() -> None:
        frame.get_by_role("button", name="cliquer pour").first.click()

    def select_year_in_picker() -> None:
        frame.get_by_role("button", name=year, exact=True).click()

    def select_month(month: int) -> None:
        last_error = None
        for candidate in MONTH_ABBR_CANDIDATES[month]:
            try:
                frame.get_by_role("button", name=candidate, exact=True).click(timeout=3000)
                return
            except Exception as exc:
                last_error = exc
        raise RuntimeError(f"Impossible de selectionner le mois {month}") from last_error

    def select_day(day: int) -> None:
        frame.get_by_role("button", name=f"{day:02d}", exact=True).click()

    open_month_year_picker()
    select_year_in_picker()
    select_month(1)
    select_day(1)

    open_month_year_picker()
    select_year_in_picker()

    if int(year) >= datetime.now().year:
        end_date = datetime.now() - timedelta(days=1)
        end_month, end_day = end_date.month, end_date.day
    else:
        end_month, end_day = 12, 31
    select_month(end_month)
    select_day(end_day)

    dismiss_calendar_overlay(page)


def download(year: str | None = None) -> None:
    if not STATE_PATH.exists():
        raise SystemExit(
            f"{STATE_PATH} introuvable. Lancez d'abord: python scripts/enedis_download.py --login"
        )

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target_year = year or str(datetime.now().year)
    logger.info("Debut du telechargement pour l'annee %s", target_year)

    with sync_playwright() as p:
        # headed (not headless) on purpose: the same bot-detection that blocks
        # the bundled Chromium is more likely to flag a headless real Chrome too.
        browser = p.chromium.launch(headless=False, **LAUNCH_KWARGS)
        # A larger-than-default viewport: the year-picker button can render
        # partly below the fold on the default 1280x720 size, which causes
        # Playwright's click to land on whatever overlay/header is actually
        # on top at that point instead of the year button underneath it.
        context = browser.new_context(storage_state=str(STATE_PATH), viewport={"width": 1600, "height": 1000})
        page = context.new_page()

        # A fresh page load per metric, rather than reusing one page/tab for
        # all three: leftover overlay state (calendar/dropdown not fully
        # closed) from one metric was observed to block clicks on the next.
        for label, prefix, period_mode in METRICS:
            logger.info("Traitement de la metrique: %s", label)
            page.goto(URL)
            page.wait_for_load_state("networkidle")
            dismiss_cookie_banner(page)
            dismiss_popup_dialogs(page)

            frame = page.frame_locator(MEASURES_FRAME_SELECTOR)

            try:
                frame.get_by_text(TRIGGER_PATTERN).first.wait_for(timeout=15000)
                select_metric(frame, label)

                if period_mode == "year_tab":
                    logger.info("Selection de la vue annee %s", target_year)
                    select_year_view(page, frame, target_year)
                elif period_mode == "date_range":
                    logger.info("Selection de la plage de dates pour l'annee %s", target_year)
                    select_index_date_range(page, frame, target_year)

                with page.expect_download() as download_info:
                    frame.get_by_text("Télécharger le .xlsx", exact=True).click()
                dl = download_info.value
            except Exception:
                debug_path = RAW_DIR.parent / f"debug_failure_{prefix}.png"
                page.screenshot(path=str(debug_path))
                logger.exception("Echec pour %s. Capture: %s", label, debug_path)
                browser.close()
                raise

            dest = RAW_DIR / f"{prefix}_{timestamp}.xlsx"
            dl.save_as(str(dest))
            logger.info("Telecharge: %s", dest)

        browser.close()
    logger.info("Telechargement termine pour l'annee %s", target_year)


def dismiss_cookie_banner(page) -> None:
    for text in ("Accepter", "Tout accepter", "J'accepte"):
        button = page.get_by_role("button", name=text)
        try:
            if button.count() and button.first.is_visible(timeout=2000):
                button.first.click()
                return
        except Exception:
            continue


def dismiss_popup_dialogs(page) -> None:
    """Close the AB Tasty "Votre outil de suivi a évolué" overlay, which
    reappears on every page load and intercepts clicks on the period/tab
    controls underneath it."""
    for selector in (".ab_widget_container_custom-code_close_button", '[aria-label="Close dialog"]'):
        try:
            close_button = page.locator(selector)
            if close_button.count() and close_button.first.is_visible(timeout=1000):
                close_button.first.click()
                return
        except Exception:
            continue


def inspect(metric: str | None = None) -> None:
    """Open the authenticated page and pause with the Playwright Inspector
    so selectors can be picked manually (devtools "Copy selector" or the
    inspector's element picker)."""
    if not STATE_PATH.exists():
        raise SystemExit(
            f"{STATE_PATH} introuvable. Lancez d'abord: python scripts/enedis_download.py --login"
        )
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, **LAUNCH_KWARGS)
        context = browser.new_context(storage_state=str(STATE_PATH), viewport={"width": 1600, "height": 1000})
        page = context.new_page()
        page.goto(URL)
        page.wait_for_load_state("networkidle")
        dismiss_cookie_banner(page)
        dismiss_popup_dialogs(page)
        if metric:
            label = next((lbl for lbl, prefix, _ in METRICS if prefix == metric), None)
            if label is None:
                raise SystemExit(f"Metrique inconnue: {metric}. Choix: energy, index, powermax")
            frame = page.frame_locator(MEASURES_FRAME_SELECTOR)
            frame.get_by_text(TRIGGER_PATTERN).first.wait_for(timeout=15000)
            select_metric(frame, label)
            print(f"Metrique '{label}' selectionnee. Cliquez le champ de periode/date pour inspecter son widget.")
        print(f"Widget de mesures dans l'iframe: {MEASURES_FRAME_SELECTOR}")
        page.pause()
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--login", action="store_true", help="Login manuel et sauvegarde de la session")
    parser.add_argument(
        "--inspect", action="store_true", help="Ouvre la page authentifiee avec l'inspecteur Playwright"
    )
    parser.add_argument(
        "--metric",
        choices=["energy", "index", "powermax"],
        help="Avec --inspect: pre-selectionne cette metrique avant de faire la pause",
    )
    parser.add_argument(
        "--year", help="Annee a telecharger pour Energie/Puissance maximale (defaut: annee en cours)"
    )
    args = parser.parse_args()

    if args.login:
        login()
    elif args.inspect:
        inspect(args.metric)
    else:
        download(args.year)
