"""
Forecasts daily electricity consumption (ene_conso) with Amazon Chronos-2, following the
official Chronos2Pipeline.predict_df example, but using the `dataset` table's other
measured columns as historical context instead of a plain univariate series.

predict_df treats any context column also present in future_df as a "known-future"
covariate (supplied for the forecast window too); everything else in context_df is
"past-only" (historical context only, never supplied for the forecast window). Here only
a handful of calendar-derived columns are known-future - the rest of the calendar columns
and a few noisy/low-signal measured columns are excluded entirely.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import mlflow
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

try:
    from chronos import Chronos2Pipeline
except ImportError:
    print(
        "Warning: 'chronos' library not found or too old (Chronos2Pipeline missing). "
        "Please install/upgrade with 'pip install -U chronos-forecasting'."
    )
    sys.exit(1)

# Add backend directory to sys.path so we can import from app
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.core.db import engine

REGISTERED_MODEL_NAME = "Joule_Chronos2_Energy_Prediction"

MODEL_ID = "amazon/chronos-2"
SERIES_ID = "joule"
TARGET_COL = "ene_conso_withouttesla"

FUTURE_START_DATE = pd.Timestamp("2026-04-01")
FUTURE_PREDICTION_DAYS = 90
QUANTILE_LEVELS = [0.1, 0.5, 0.9]

# Known ahead of time for any future date -> supplied via future_df.
KNOWN_FUTURE_COVARIATES = [
    "date_sin_dayofweek", "date_cos_dayofweek", "date_sin_month", "date_cos_month",
    "date_is_weekend", "date_dayofyear", "cli_tempmoy",
]

# Excluded entirely for now: unused calendar columns plus a few noisy/low-signal measured ones.
EXCLUDED_COLUMNS = [
    "date_dayofweek", "date_quarter", "date_month", "date_year",
    "date_dayofmonth", "date_weekofyear",
    "ene_conso", "tes_homekwh",
]


class Chronos2Model(mlflow.pyfunc.PythonModel):
    """Wraps Chronos2Pipeline so it can be logged/registered in MLflow.

    Re-downloads the pretrained weights from Hugging Face by MODEL_ID at load
    time rather than storing them as MLflow artifacts, since they're static
    and multiple GB in size.
    """

    def load_context(self, context):
        self.pipeline = Chronos2Pipeline.from_pretrained(
            MODEL_ID,
            device_map="cuda" if torch.cuda.is_available() else "cpu",
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        )

    def predict(self, context, model_input, params=None):
        return self.pipeline.predict_df(
            model_input["context_df"],
            future_df=model_input["future_df"],
            prediction_length=model_input.get("prediction_length", FUTURE_PREDICTION_DAYS),
            quantile_levels=model_input.get("quantile_levels", QUANTILE_LEVELS),
            id_column="id",
            timestamp_column="timestamp",
            target=TARGET_COL,
        )


def load_dataset() -> pd.DataFrame:
    df = pd.read_sql("SELECT * FROM dataset ORDER BY date", con=engine)
    if df.empty:
        raise SystemExit("Dataset is empty. Run dataset_creation.py first.")
    df["timestamp"] = pd.to_datetime(df["date"])
    df = df.drop(columns=["id", "date"] + EXCLUDED_COLUMNS)
    df["id"] = SERIES_ID  # single time series -> constant item id, as predict_df expects
    return df.sort_values("timestamp").reset_index(drop=True)


def main():
    print("Loading data from dataset table...")
    df = load_dataset()
    print(f"Loaded {len(df)} rows, {df['timestamp'].min().date()} .. {df['timestamp'].max().date()}.")

    past_only_covariates = [
        c for c in df.columns if c not in ("id", "timestamp", TARGET_COL) and c not in KNOWN_FUTURE_COVARIATES
    ]
    print(f"Known-future covariates: {KNOWN_FUTURE_COVARIATES}")
    print(f"Past-only covariates (context only, never known ahead of time): {past_only_covariates}")

    # Context stops the day before the forecast window so the two are contiguous, as
    # Chronos-2 requires (future_df timestamps must pick up right where context_df ends).
    context_cutoff = FUTURE_START_DATE - pd.Timedelta(days=1)
    future_dates = pd.date_range(start=FUTURE_START_DATE, periods=FUTURE_PREDICTION_DAYS, freq="D")

    context_df = df[df["timestamp"] <= context_cutoff].copy()
    if context_df.empty:
        raise SystemExit(f"No data before {context_cutoff.date()} to use as context.")

    future_rows = df[df["timestamp"].isin(future_dates)].set_index("timestamp")

    future_df = pd.DataFrame({"timestamp": future_dates})
    future_df["id"] = SERIES_ID
    for col in KNOWN_FUTURE_COVARIATES:
        future_df[col] = future_df["timestamp"].map(future_rows[col])
    future_df = future_df[["id", "timestamp"] + KNOWN_FUTURE_COVARIATES]

    # If the dataset already has actual readings for the forecast window (e.g. because this
    # is a backtest over a past period), keep them aside to score the forecast.
    if TARGET_COL in future_rows.columns:
        actual = pd.Series(future_dates).map(future_rows[TARGET_COL]).to_numpy()
    else:
        actual = np.full(len(future_dates), np.nan)

    print(f"Context: {len(context_df)} rows through {context_df['timestamp'].max().date()}.")
    print(f"Forecasting {FUTURE_PREDICTION_DAYS} days: {future_dates[0].date()} .. {future_dates[-1].date()}.")

    # Set up MLflow
    # Use the MLflow server running in Docker
    mlflow.set_tracking_uri("http://localhost:5001")

    experiment_name = "Joule"
    experiment = mlflow.get_experiment_by_name(experiment_name)
    if experiment is None:
        mlflow.create_experiment(experiment_name)
    mlflow.set_experiment(experiment_name)

    with mlflow.start_run() as run:
        run_name = run.info.run_name

        context_dataset = mlflow.data.from_pandas(context_df, targets=TARGET_COL, name="context_dataset")
        mlflow.log_input(context_dataset, context="training")

        mlflow.log_param("model_id", MODEL_ID)
        mlflow.log_param("prediction_length", FUTURE_PREDICTION_DAYS)
        mlflow.log_param("forecast_start", str(future_dates[0].date()))
        mlflow.log_param("forecast_end", str(future_dates[-1].date()))
        mlflow.log_param("known_future_covariates", ",".join(KNOWN_FUTURE_COVARIATES))
        mlflow.log_param("past_only_covariates", ",".join(past_only_covariates))

        print("Loading Amazon Chronos-2 model...")
        pipeline = Chronos2Pipeline.from_pretrained(
            MODEL_ID,
            device_map="cuda" if torch.cuda.is_available() else "cpu",
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        )

        print(f"Generating {FUTURE_PREDICTION_DAYS}-day forecast with covariates...")
        pred_df = pipeline.predict_df(
            context_df,
            future_df=future_df,
            prediction_length=FUTURE_PREDICTION_DAYS,
            quantile_levels=QUANTILE_LEVELS,
            id_column="id",
            timestamp_column="timestamp",
            target=TARGET_COL,
        )

        result_df = pd.DataFrame({
            "date": future_dates,
            "predicted_ene_conso": pred_df["predictions"].to_numpy(),
            "p10_ene_conso": pred_df["0.1"].to_numpy(),
            "p50_ene_conso": pred_df["0.5"].to_numpy(),
            "p90_ene_conso": pred_df["0.9"].to_numpy(),
            "actual_ene_conso": actual,
        })

        # Score against actuals wherever the dataset already has them (backtest); days with
        # no reading yet (a genuine blind forecast) are simply excluded from the metrics.
        known = result_df["actual_ene_conso"].notna()
        if known.any():
            y_true = result_df.loc[known, "actual_ene_conso"].to_numpy()
            y_pred = result_df.loc[known, "predicted_ene_conso"].to_numpy()
            rmse = np.sqrt(mean_squared_error(y_true, y_pred))
            mae = mean_absolute_error(y_true, y_pred)
            print(f"Backtest metrics over {known.sum()} known day(s) - RMSE: {rmse:.4f}, MAE: {mae:.4f}", end="")
            mlflow.log_metric("rmse", rmse)
            mlflow.log_metric("mae", mae)
            if known.sum() > 1:
                r2 = r2_score(y_true, y_pred)
                print(f", R2: {r2:.4f}")
                mlflow.log_metric("r2", r2)
            else:
                print()
                
            # Calculate Quantile Loss (Pinball Loss) for probabilistic evaluation
            quantile_losses = {}
            for q_str, q_val in [("p10", 0.1), ("p50", 0.5), ("p90", 0.9)]:
                y_pred_q = result_df.loc[known, f"{q_str}_ene_conso"].to_numpy()
                diff = y_true - y_pred_q
                loss = np.maximum(q_val * diff, (q_val - 1) * diff).mean()
                quantile_losses[f"quantile_loss_{q_str}"] = loss
                mlflow.log_metric(f"quantile_loss_{q_str}", loss)
                
            mean_ql = np.mean(list(quantile_losses.values()))
            mlflow.log_metric("mean_quantile_loss", mean_ql)
            print(f"Quantile Loss - Mean: {mean_ql:.4f} (p10: {quantile_losses['quantile_loss_p10']:.4f}, p50: {quantile_losses['quantile_loss_p50']:.4f}, p90: {quantile_losses['quantile_loss_p90']:.4f})")
        else:
            print("No actual readings yet for the forecast window; skipping backtest metrics.")

        print("\nSample of predictions:")
        print(result_df.head(10))

        predictions_dir = Path(__file__).resolve().parent.parent / "data" / "predictions"
        predictions_dir.mkdir(parents=True, exist_ok=True)
        output_path = predictions_dir / f"Joule_Chronos2_Energy_Prediction_{run_name}.csv"
        round_cols = ["predicted_ene_conso", "p10_ene_conso", "p50_ene_conso", "p90_ene_conso", "actual_ene_conso"]
        result_df[round_cols] = result_df[round_cols].round(2)
        result_df.to_csv(output_path, index=False)
        mlflow.log_artifact(str(output_path))
        print(f"\nPredictions saved to {output_path}")

        mlflow.pyfunc.log_model(
            "chronos2_model",
            python_model=Chronos2Model(),
            pip_requirements=["chronos-forecasting", "torch", "pandas", "numpy"],
            registered_model_name=REGISTERED_MODEL_NAME,
        )
        print(f"Model logged and registered to MLflow as '{REGISTERED_MODEL_NAME}'.")


if __name__ == "__main__":
    main()
