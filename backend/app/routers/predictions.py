import math
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user_email
from app.models import FeatureEngineering

router = APIRouter(
    prefix="/predictions", tags=["predictions"], dependencies=[Depends(get_current_user_email)]
)

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "predictions"

MODEL_FILE_PATTERNS = {
    "Chronos2": "Joule_Chronos2_*.csv",
    "TimesFM": "Joule_TimesFM_*.csv",
    "XGBoost": "Joule_XGBoost_*.csv",
    "Average": "Joule_Average_*.csv",
    "Prophet": "Joule_Prophet_*.csv",
}


@router.get("/models")
def list_model_predictions(db: Session = Depends(get_db)):
    import pandas as pd

    actuals = {
        r.date.isoformat(): r.ene_conso_withouttesla
        for r in db.execute(
            select(FeatureEngineering.date, FeatureEngineering.ene_conso_withouttesla)
        ).all()
        if r.ene_conso_withouttesla is not None
    }

    result = []
    for model_name, pattern in MODEL_FILE_PATTERNS.items():
        files = sorted(DATA_DIR.glob(pattern), key=lambda p: p.stat().st_mtime)
        if not files:
            continue
        latest_file = files[-1]

        df = pd.read_csv(latest_file)
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

        points = []
        errors = []
        pct_errors = []
        for _, row in df.iterrows():
            date_str = row["date"]
            predicted = row["predicted_ene_conso"]
            predicted = None if pd.isna(predicted) else float(predicted)
            actual = actuals.get(date_str)

            points.append({"date": date_str, "predicted": predicted, "actual": actual})

            if predicted is not None and actual is not None:
                error = predicted - actual
                errors.append(error)
                if actual != 0:
                    pct_errors.append(abs(error) / actual)

        metrics = None
        if errors:
            n = len(errors)
            mae = sum(abs(e) for e in errors) / n
            rmse = math.sqrt(sum(e**2 for e in errors) / n)
            bias = sum(errors) / n
            metrics = {
                "n": n,
                "mae": mae,
                "rmse": rmse,
                "bias": bias,
                "mape": (sum(pct_errors) / len(pct_errors) * 100) if pct_errors else None,
            }

        result.append(
            {
                "model": model_name,
                "file": latest_file.name,
                "points": points,
                "metrics": metrics,
            }
        )

    return result


@router.get("/forecast")
def get_forecast(db: Session = Depends(get_db)):
    import pandas as pd

    actuals = {
        r.date.isoformat(): r.ene_conso_withouttesla
        for r in db.execute(
            select(FeatureEngineering.date, FeatureEngineering.ene_conso_withouttesla)
        ).all()
        if r.ene_conso_withouttesla is not None
    }

    files = sorted(DATA_DIR.glob("prediction_prod_*.csv"), key=lambda p: p.stat().st_mtime)
    if not files:
        return {"file": None, "points": [], "metrics": None}

    latest_file = files[-1]
    df = pd.read_csv(latest_file)
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")

    def _num(value):
        return None if pd.isna(value) else float(value)

    points = []
    errors = []
    pct_errors = []
    for _, row in df.iterrows():
        date_str = row["date"]
        predicted = _num(row.get("predicted_ene_conso"))
        p10 = _num(row.get("p10_ene_conso"))
        p90 = _num(row.get("p90_ene_conso"))
        actual = actuals.get(date_str)

        points.append(
            {
                "date": date_str,
                "predicted": predicted,
                "p10": p10,
                "p90": p90,
                "actual": actual,
            }
        )

        if predicted is not None and actual is not None:
            error = predicted - actual
            errors.append(error)
            if actual != 0:
                pct_errors.append(error / actual)

    metrics = None
    if errors:
        n = len(errors)
        mae = sum(abs(e) for e in errors) / n
        rmse = math.sqrt(sum(e**2 for e in errors) / n)
        bias = sum(errors) / n
        metrics = {
            "n": n,
            "mae": mae,
            "rmse": rmse,
            "bias": bias,
            "mape": (sum(abs(e) for e in pct_errors) / len(pct_errors) * 100) if pct_errors else None,
            "pct_bias": (sum(pct_errors) / len(pct_errors) * 100) if pct_errors else None,
        }

    return {"file": latest_file.name, "points": points, "metrics": metrics}
