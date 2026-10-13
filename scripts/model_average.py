"""Model Average Script
-----------------------
Predicts daily ene_conso_withouttesla (ene_conso minus Tesla home charging)
for 2026-04-01 -> 2026-06-29, using only historical data from 2022-01-01 up
to (strictly before) the 2026-03-31 cutoff.

For each target date, the prediction is the historical average of
ene_conso_withouttesla for that same calendar day (month, day) across all
past years in that window. This is a naive day-of-year seasonal average, not
a trained model.

Results are written as a CSV file in data/predictions, following the same
date,predicted_ene_conso format as the other model prediction files, so it
shows up in /predictions/models alongside Chronos2/TimesFM/XGBoost.

Usage (from repo root):
    python scripts/model_average.py
"""

import sys
import uuid
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models import FeatureEngineering

HISTORY_START = date(2022, 1, 1)  # historical data must be on or after this date
CUTOFF = date(2026, 3, 31)  # historical data must be strictly before this date

TARGET_START = date(2026, 4, 1)
TARGET_END = date(2026, 6, 29)

PREDICTIONS_DIR = REPO_ROOT / "data" / "predictions"


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def run_model_average():
    db: Session = SessionLocal()
    try:
        print(f"Fetching historical readings from {HISTORY_START.isoformat()} to before {CUTOFF.isoformat()}...")
        readings = db.execute(
            select(FeatureEngineering).where(
                FeatureEngineering.date >= HISTORY_START, FeatureEngineering.date < CUTOFF
            )
        ).scalars().all()

        by_day_of_year: dict[tuple[int, int], list[float]] = defaultdict(list)
        for r in readings:
            if r.ene_conso_withouttesla is None:
                continue
            by_day_of_year[(r.date.month, r.date.day)].append(r.ene_conso_withouttesla)

        actuals = {
            r.date: r.ene_conso_withouttesla
            for r in db.execute(
                select(FeatureEngineering).where(
                    FeatureEngineering.date >= TARGET_START, FeatureEngineering.date <= TARGET_END
                )
            ).scalars().all()
        }

        rows = []
        for target_date in daterange(TARGET_START, TARGET_END):
            values = by_day_of_year.get((target_date.month, target_date.day), [])
            predicted = round(sum(values) / len(values), 2) if values else None
            actual = actuals.get(target_date)
            rows.append(
                {
                    "date": target_date.isoformat(),
                    "predicted_ene_conso": predicted,
                    "actual_ene_conso": round(actual, 2) if actual is not None else None,
                }
            )

        PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
        output_path = PREDICTIONS_DIR / f"Joule_Average_Energy_Prediction_{uuid.uuid4().hex[:8]}.csv"
        pd.DataFrame(rows).to_csv(output_path, index=False)

        print(f"Wrote {len(rows)} predictions to {output_path}")

    finally:
        db.close()


if __name__ == "__main__":
    run_model_average()
