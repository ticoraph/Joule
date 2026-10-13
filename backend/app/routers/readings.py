from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user_email
from app.models import DailyReading, FeatureEngineering
from app.schemas import DailyReadingOut

router = APIRouter(
    prefix="/readings", tags=["readings"], dependencies=[Depends(get_current_user_email)]
)


@router.get("/daily", response_model=list[DailyReadingOut])
def list_daily_readings(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    stmt = (
        select(
            DailyReading,
            FeatureEngineering.eco_kwh_per_daylighthour,
            FeatureEngineering.eco_actual_prod_minus_expected,
            FeatureEngineering.eco_ratio_solarperconsototal,
            FeatureEngineering.ene_hcwithoutesla_to_hp_ratio,
            FeatureEngineering.ene_conso_withouttesla,
            FeatureEngineering.cli_amplitude_tmax_min,
        )
        .outerjoin(FeatureEngineering, DailyReading.date == FeatureEngineering.date)
        .order_by(DailyReading.date)
    )
    if start:
        stmt = stmt.where(DailyReading.date >= start)
    if end:
        stmt = stmt.where(DailyReading.date <= end)

    rows = db.execute(stmt).all()
    out = []
    for row in rows:
        dr = row[0]
        data = dr.__dict__.copy()
        data["eco_kwh_per_daylighthour"] = row[1]
        data["eco_actual_prod_minus_expected"] = row[2]
        data["eco_ratio_solarperconsototal"] = row[3]
        data["ene_hcwithoutesla_to_hp_ratio"] = row[4]
        data["ene_conso_withouttesla"] = row[5]
        data["cli_amplitude_tmax_min"] = row[6]
        out.append(data)
    
    return out


CORR_KEYS = [
    "cli_amplitude_tmax_min",
    "cli_precip",
    "cli_tempmoy",
    "eco_kwh_per_daylighthour",
    "eco_actual_prod_minus_expected",
    "eco_ratio_solarperconsototal",
    "ene_conso_withouttesla",
    "ene_hc_byday",
    "ene_hp_byday",
    "ene_pmax",
    "ene_hcwithoutesla_to_hp_ratio",
    "sun_daylight_minute",
]


def _train_xgb_for_target(target: str, db: Session):
    """Fetch daily readings, build a numeric frame over CORR_KEYS, and fit an
    XGBRegressor predicting `target` from the remaining CORR_KEYS. Returns
    (model, X, features) or None if there is no usable data."""
    import pandas as pd
    import xgboost as xgb

    data = list_daily_readings(start=None, end=None, db=db)
    if not data:
        return None

    df = pd.DataFrame(data)

    available_cols = [c for c in CORR_KEYS if c in df.columns]
    if target not in available_cols:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail=f"Target {target} not found in data. Columns: {df.columns.tolist()}")

    features = [c for c in available_cols if c != target]

    for col in available_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=[target])
    if len(df) == 0:
        return None

    X = df[features]
    y = df[target]

    model = xgb.XGBRegressor(
        n_estimators=50,
        max_depth=3,
        learning_rate=0.1,
        random_state=42,
    )
    model.fit(X, y)

    return model, X, features


@router.get("/feature-importance")
def get_feature_importance(
    target: str = Query(..., description="The target variable to predict"),
    db: Session = Depends(get_db),
):
    from fastapi import HTTPException
    import traceback

    try:
        if target not in CORR_KEYS:
            raise HTTPException(status_code=400, detail=f"Invalid target: {target}")

        try:
            import xgboost  # noqa: F401
        except ImportError as e:
            raise HTTPException(status_code=500, detail=f"ImportError: {e}")

        trained = _train_xgb_for_target(target, db)
        if trained is None:
            return []
        model, _X, features = trained

        importances = model.feature_importances_

        result = []
        for feat, imp in zip(features, importances):
            result.append({
                "feature": feat,
                "importance": float(imp)
            })

        # Sort descending
        result.sort(key=lambda x: x["importance"], reverse=True)
        return result
    except HTTPException:
        raise
    except Exception as e:
        with open("xgboost_error.log", "w") as f:
            f.write(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/feature-shap")
def get_feature_shap(
    target: str = Query(..., description="The target variable to predict"),
    db: Session = Depends(get_db),
):
    from fastapi import HTTPException
    import traceback

    try:
        if target not in CORR_KEYS:
            raise HTTPException(status_code=400, detail=f"Invalid target: {target}")

        try:
            import numpy as np
            import xgboost as xgb
        except ImportError as e:
            raise HTTPException(status_code=500, detail=f"ImportError: {e}")

        trained = _train_xgb_for_target(target, db)
        if trained is None:
            return []
        model, X, features = trained

        # XGBoost natively computes SHAP values via pred_contribs, no extra
        # dependency needed. Output shape is (n_samples, n_features + 1),
        # the last column being the expected-value/bias term.
        booster = model.get_booster()
        dmatrix = xgb.DMatrix(X, feature_names=features)
        contribs = booster.predict(dmatrix, pred_contribs=True)
        shap_values = contribs[:, :-1]

        mean_abs_shap = np.abs(shap_values).mean(axis=0)

        result = []
        for i, feat in enumerate(features):
            raw_values = X[feat].to_numpy(dtype=float)
            finite_mask = np.isfinite(raw_values)
            if finite_mask.any():
                v_min = float(raw_values[finite_mask].min())
                v_max = float(raw_values[finite_mask].max())
                v_range = v_max - v_min
            else:
                v_range = 0.0

            points = []
            for j in range(len(raw_values)):
                if finite_mask[j] and v_range > 0:
                    norm = float((raw_values[j] - v_min) / v_range)
                elif finite_mask[j]:
                    norm = 0.5
                else:
                    norm = None
                points.append({
                    "shapValue": float(shap_values[j, i]),
                    "featureValueNorm": norm,
                })

            result.append({
                "feature": feat,
                "meanAbsShap": float(mean_abs_shap[i]),
                "points": points,
            })

        result.sort(key=lambda x: x["meanAbsShap"], reverse=True)
        return result
    except HTTPException:
        raise
    except Exception as e:
        with open("shap_error.log", "w") as f:
            f.write(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
