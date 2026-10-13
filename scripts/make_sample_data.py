"""Generate a synthetic dataset so Joule runs without anyone's real meter data.

Fills the `daily_readings` table (data/joule.db by default) with seasonal, noisy,
made-up values for 2022-01-01 .. 2026-06-30, then runs the same derived-table steps
as the real pipeline (`feature_engineering.py`, `dataset_creation.py`).

Usage (from repo root, with backend/requirements.txt installed):
    python scripts/make_sample_data.py [--seed 42]

Nothing here comes from a real household: consumption is a winter-heavy sinusoid plus
noise, the weather/solar columns follow simple seasonal curves. It is only meant to make
the dashboard, the Feature Engineering page and the training scripts usable out of the box.
"""

import argparse
import math
import random
import sys
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.models import DailyReading  # noqa: E402

START = date(2022, 1, 1)
END = date(2026, 6, 30)


def build_row(day: date, rng: random.Random, state: dict) -> DailyReading:
    doy = day.timetuple().tm_yday
    season = math.cos(2 * math.pi * (doy - 15) / 365)  # +1 mid-January, -1 mid-July
    temp_moy = 11 - 10 * season + rng.gauss(0, 2.5)
    precip = max(0.0, rng.gauss(1.2, 3.0)) if rng.random() < 0.35 else 0.0
    daylight = round(727 - 222 * season + rng.gauss(0, 2))

    weekend = 1.12 if day.weekday() >= 5 else 1.0
    tesla_kwh = round(rng.uniform(5, 22), 2) if rng.random() < 0.3 else 0.0
    base = (11 + 9 * max(season, 0) + 2 * (1 - abs(season))) * weekend
    conso = max(2.0, base + tesla_kwh * 0.8 + rng.gauss(0, 1.8))
    hc_share = min(0.65, max(0.25, 0.4 + (0.1 if tesla_kwh else 0) + rng.gauss(0, 0.04)))

    solar = max(0.0, (daylight - 480) / 240 * 4.5 * rng.uniform(0.2, 1.0))
    to_battery = solar * rng.uniform(0.25, 0.45)
    to_home = solar - to_battery
    discharge = to_battery * rng.uniform(0.85, 0.95)

    state["index"] += conso
    pmax = round(max(0.8, 2.2 + 1.8 * max(season, 0) + (2.0 if tesla_kwh else 0) + rng.gauss(0, 0.6)), 1)
    sunrise_min = 12 * 60 - daylight // 2
    sunset_min = 12 * 60 + daylight // 2

    return DailyReading(
        date=day,
        ene_conso=round(conso, 1),
        ene_index_total=round(state["index"], 1),
        ene_index_hp=round(state["index"] * (1 - hc_share), 1),
        ene_index_hc=round(state["index"] * hc_share, 1),
        ene_pmax=pmax,
        ene_pmax_hour=f"{rng.choice([7, 8, 12, 19, 20, 21])}:{rng.randrange(0, 60):02d}",
        ene_hp_byday=round(conso * (1 - hc_share), 1),
        ene_hc_byday=round(conso * hc_share, 1),
        ene_hp_percent=round((1 - hc_share) * 100, 1),
        ene_hc_percent=round(hc_share * 100, 1),
        eco_solartotalgeneration=round(solar, 2),
        eco_solartobattery=round(to_battery, 2),
        eco_solartohome=round(to_home, 2),
        eco_hometoloads=round(to_home + discharge, 2),
        eco_batterytotaldischarging=round(discharge, 2),
        eco_batterydiff=round(to_battery - discharge, 2),
        cli_tempmax=round(temp_moy + 4 + rng.gauss(0, 1), 1),
        cli_tempmin=round(temp_moy - 4 + rng.gauss(0, 1), 1),
        cli_tempmoy=round(temp_moy, 1),
        cli_precip=round(precip, 1),
        eau_conso=round(max(0.0, rng.gauss(0.45, 0.12)), 2),
        tes_totalkwh=tesla_kwh,
        tes_homekwh=tesla_kwh,
        tes_superchargerkwh=0.0,
        tes_workkwh=0.0,
        tes_otherkwh=0.0,
        tes_totalcosteur=round(tesla_kwh * 0.17, 2),
        sun_sunrise_hour=f"{sunrise_min // 60:02d}:{sunrise_min % 60:02d}",
        sun_sunset_hour=f"{sunset_min // 60:02d}:{sunset_min % 60:02d}",
        sun_daylight_minute=daylight,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    Path(REPO_ROOT / "data").mkdir(exist_ok=True)
    Base.metadata.create_all(bind=engine)

    state = {"index": 10_000.0}
    with SessionLocal() as db:
        existing = {d for (d,) in db.query(DailyReading.date).all()}
        added = 0
        day = START
        while day <= END:
            row = build_row(day, rng, state)  # always advance the RNG so reruns are reproducible
            if day not in existing:
                db.add(row)
                added += 1
            day += timedelta(days=1)
        db.commit()
    print(f"Inserted {added} synthetic days into daily_readings.")

    import dataset_creation
    import feature_engineering

    feature_engineering.run_feature_engineering()
    dataset_creation.create_dataset()


if __name__ == "__main__":
    main()
