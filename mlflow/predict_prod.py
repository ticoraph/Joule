"""Promote a registered model version to Production and generate the prod forecast CSV.

Supports the three models trained by mlflow/train_*.py, each with a different pyfunc
predict() contract, so the request/response shape is built per model:
  - Joule_Chronos2_Energy_Prediction (mlflow/train_chronos2.py): dict of
    context_df/future_df/prediction_length/quantile_levels -> DataFrame with quantile columns.
  - Joule_TimesFM_Energy_Prediction (mlflow/train_timesfm.py): dict of inputs/horizon ->
    (point_forecasts, quantiles) tuple, univariate.
  - Joule_XGBoost_Energy_Predictor (mlflow/train_xgboost.py): flat feature DataFrame ->
    array of point predictions, no quantiles; future feature values are filled in from
    historical day-of-year averages the same way train_xgboost.py does for its own backtest.

Usage (from repo root):
    python mlflow/predict_prod.py --model Joule_Chronos2_Energy_Prediction --version 6
    python mlflow/predict_prod.py --model Joule_TimesFM_Energy_Prediction --version 5
    python mlflow/predict_prod.py --model Joule_XGBoost_Energy_Predictor --version 5
    python mlflow/predict_prod.py --model Joule_Prophet_Energy_Prediction --version 1
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import mlflow
from mlflow.tracking import MlflowClient

# Setup DB connection
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))
from app.core.db import engine

TARGET_COL = "ene_conso_withouttesla"
SERIES_ID = "joule"

FUTURE_START_DATE = pd.Timestamp("2026-07-01")
FUTURE_END_DATE = pd.Timestamp("2026-09-30")
FUTURE_PREDICTION_DAYS = (FUTURE_END_DATE - FUTURE_START_DATE).days + 1
FUTURE_DATES = pd.date_range(start=FUTURE_START_DATE, periods=FUTURE_PREDICTION_DAYS, freq="D")

MODEL_SLUGS = {
    "Joule_Chronos2_Energy_Prediction": "chronos2",
    "Joule_TimesFM_Energy_Prediction": "timesfm",
    "Joule_XGBoost_Energy_Predictor": "xgboost",
    "Joule_Prophet_Energy_Prediction": "prophet",
}


def load_raw_dataset() -> pd.DataFrame:
    df = pd.read_sql("SELECT * FROM dataset ORDER BY date", con=engine)
    if df.empty:
        raise SystemExit("Dataset is empty. Run scripts/dataset_creation.py first.")
    df["timestamp"] = pd.to_datetime(df["date"])
    return df.sort_values("timestamp").reset_index(drop=True)


def predict_chronos2(model, df: pd.DataFrame) -> pd.DataFrame:
    known_future_covariates = [
        "date_sin_dayofweek", "date_cos_dayofweek", "date_sin_month", "date_cos_month",
        "date_is_weekend", "date_dayofyear", "cli_tempmoy",
    ]
    excluded_columns = [
        "date_dayofweek", "date_quarter", "date_month", "date_year",
        "date_dayofmonth", "date_weekofyear",
        "cli_precip", "eco_actual_prod_minus_expected",
        "ene_conso", "tes_homekwh",
    ]

    ctx = df.drop(columns=["id", "date"] + excluded_columns, errors="ignore").copy()
    ctx["id"] = SERIES_ID

    context_cutoff = FUTURE_START_DATE - pd.Timedelta(days=1)
    context_df = ctx[ctx["timestamp"] <= context_cutoff].copy()

    future_rows = ctx[ctx["timestamp"].isin(FUTURE_DATES)].set_index("timestamp")
    future_df = pd.DataFrame({"timestamp": FUTURE_DATES})
    future_df["id"] = SERIES_ID
    for col in known_future_covariates:
        if col in future_rows.columns:
            future_df[col] = future_df["timestamp"].map(future_rows[col])
        else:
            print(f"Warning: {col} not found in future_rows")
    if future_df[known_future_covariates].isnull().any().any():
        print("Warning: some known future covariates are null in the future dataframe.")
        future_df.fillna(method="ffill", inplace=True)
    future_df = future_df[["id", "timestamp"] + known_future_covariates]

    model_input = {
        "context_df": context_df,
        "future_df": future_df,
        "prediction_length": FUTURE_PREDICTION_DAYS,
        "quantile_levels": [0.1, 0.5, 0.9],
    }
    pred_df = model.predict(model_input)

    return pd.DataFrame({
        "date": FUTURE_DATES,
        "predicted_ene_conso": pred_df["predictions"].to_numpy(),
        "p10_ene_conso": pred_df["0.1"].to_numpy(),
        "p50_ene_conso": pred_df["0.5"].to_numpy(),
        "p90_ene_conso": pred_df["0.9"].to_numpy(),
    })


def predict_timesfm(model, df: pd.DataFrame) -> pd.DataFrame:
    context_cutoff = FUTURE_START_DATE - pd.Timedelta(days=1)
    context_df = df[df["timestamp"] <= context_cutoff]
    if context_df.empty:
        raise SystemExit(f"No data before {context_cutoff.date()} to use as context.")
    context_data = context_df[TARGET_COL].to_numpy()

    forecast_res = model.predict({"inputs": [context_data], "horizon": FUTURE_PREDICTION_DAYS})
    if isinstance(forecast_res, tuple) and len(forecast_res) == 2:
        point_forecasts, quantiles = forecast_res
    else:
        point_forecasts, quantiles = forecast_res, None

    result_df = pd.DataFrame({
        "date": FUTURE_DATES,
        "predicted_ene_conso": point_forecasts[0],
    })
    if quantiles is not None:
        q_array = quantiles[0]
        if q_array.shape[1] >= 9:
            result_df["p10_ene_conso"] = q_array[:, 0]
            result_df["p50_ene_conso"] = q_array[:, 4]
            result_df["p90_ene_conso"] = q_array[:, 8]
    return result_df


def predict_xgboost(model, df: pd.DataFrame) -> pd.DataFrame:
    leaky_columns = ["ene_hc_byday", "ene_hp_byday", "ene_hcwithoutesla_to_hp_ratio", "ene_conso", "tes_homekwh"]
    feature_df = df.drop(columns=leaky_columns + ["id", "date", "timestamp"], errors="ignore")
    feature_df = feature_df.dropna(subset=[TARGET_COL])
    train_df = feature_df.drop(columns=[TARGET_COL])
    feature_cols = train_df.columns

    future_df = pd.DataFrame({"date": FUTURE_DATES})
    future_df["date_dayofweek"] = future_df["date"].dt.dayofweek
    future_df["date_quarter"] = future_df["date"].dt.quarter
    future_df["date_month"] = future_df["date"].dt.month
    future_df["date_year"] = future_df["date"].dt.year
    future_df["date_dayofyear"] = future_df["date"].dt.dayofyear
    future_df["date_dayofmonth"] = future_df["date"].dt.day
    future_df["date_weekofyear"] = future_df["date"].dt.isocalendar().week.astype(int)
    future_df["date_is_weekend"] = future_df["date_dayofweek"].apply(lambda x: 1 if x >= 5 else 0)
    future_df["date_sin_dayofweek"] = np.sin(2 * np.pi * future_df["date_dayofweek"] / 7)
    future_df["date_cos_dayofweek"] = np.cos(2 * np.pi * future_df["date_dayofweek"] / 7)
    future_df["date_sin_month"] = np.sin(2 * np.pi * future_df["date_month"] / 12)
    future_df["date_cos_month"] = np.cos(2 * np.pi * future_df["date_month"] / 12)

    non_temporal_features = [f for f in feature_cols if not f.startswith("date_")]
    doy_means = train_df.groupby("date_dayofyear")[non_temporal_features].mean().reset_index()
    future_df = future_df.merge(doy_means, on="date_dayofyear", how="left")
    for col in non_temporal_features:
        if future_df[col].isnull().any():
            future_df[col] = future_df[col].fillna(train_df[col].mean())

    X_future = future_df[feature_cols]
    predicted = model.predict(X_future)

    return pd.DataFrame({
        "date": FUTURE_DATES,
        "predicted_ene_conso": predicted,
    })


def predict_prophet(model, df: pd.DataFrame) -> pd.DataFrame:
    # Unwrap to get the underlying Prophet instance
    prophet_model = model.unwrap_python_model().model
    
    future = pd.DataFrame({'ds': FUTURE_DATES})
    forecast = prophet_model.predict(future)
    
    return pd.DataFrame({
        "date": FUTURE_DATES,
        "predicted_ene_conso": forecast["yhat"].to_numpy(),
        "p10_ene_conso": forecast["yhat_lower"].to_numpy(),
        "p50_ene_conso": forecast["yhat"].to_numpy(),
        "p90_ene_conso": forecast["yhat_upper"].to_numpy(),
    })


PREDICTORS = {
    "Joule_Chronos2_Energy_Prediction": predict_chronos2,
    "Joule_TimesFM_Energy_Prediction": predict_timesfm,
    "Joule_XGBoost_Energy_Predictor": predict_xgboost,
    "Joule_Prophet_Energy_Prediction": predict_prophet,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True, choices=sorted(PREDICTORS), help="Registered MLflow model name")
    parser.add_argument("--version", type=int, required=True, help="Model version to promote to Production")
    args = parser.parse_args()

    mlflow.set_tracking_uri("http://localhost:5001")
    client = MlflowClient()

    print(f"Transitioning {args.model} version {args.version} to Production...")
    client.transition_model_version_stage(
        name=args.model,
        version=args.version,
        stage="Production",
        archive_existing_versions=True,
    )

    print("Loading model...")
    model = mlflow.pyfunc.load_model(f"models:/{args.model}/Production")

    print("Loading data...")
    df = load_raw_dataset()

    print(f"Predicting {FUTURE_PREDICTION_DAYS} days: {FUTURE_START_DATE.date()} .. {FUTURE_END_DATE.date()}...")
    result_df = PREDICTORS[args.model](model, df)

    round_cols = [c for c in result_df.columns if c != "date"]
    result_df[round_cols] = result_df[round_cols].round(2)

    slug = MODEL_SLUGS[args.model]
    output_path = (
        Path(__file__).resolve().parent.parent / "data" / "predictions"
        / f"prediction_prod_{slug}_{FUTURE_START_DATE:%Y%m%d}_{FUTURE_END_DATE:%Y%m%d}.csv"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result_df.to_csv(output_path, index=False)
    print(f"Saved predictions to {output_path}")


if __name__ == "__main__":
    main()
