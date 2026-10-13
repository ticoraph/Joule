"""
Forecasts daily electricity consumption (ene_conso) with Google TimesFM,
following a univariate zero-shot approach based on the existing Chronos script structure.

This script loads the historical context for `ene_conso`, formats it as a 1D sequence,
and uses TimesFM to generate point forecasts and optionally quantiles.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import mlflow
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

try:
    import timesfm
except ImportError:
    print(
        "Warning: 'timesfm' library not found. "
        "Please install with 'pip install timesfm' or 'pip install timesfm[torch]'."
    )
    sys.exit(1)

# Add backend directory to sys.path so we can import from app
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.core.db import engine

REGISTERED_MODEL_NAME = "Joule_TimesFM_Energy_Prediction"

MODEL_ID = "google/timesfm-2.5-200m-pytorch"
SERIES_ID = "joule"
TARGET_COL = "ene_conso_withouttesla"

FUTURE_START_DATE = pd.Timestamp("2026-04-01")
FUTURE_PREDICTION_DAYS = 90
CONTEXT_LEN = 512

# Note: In a purely univariate setup (which is TimesFM's strong suit out of the box),
# we don't strictly need covariates, but we keep the same data structure as Chronos for easy comparison.
EXCLUDED_COLUMNS = [
    "date_dayofweek", "date_quarter", "date_month", "date_year",
    "date_dayofmonth", "date_weekofyear",
    "cli_precip", "eco_actual_prod_minus_expected",
    "ene_conso", "tes_homekwh",
]


class TimesFMModel(mlflow.pyfunc.PythonModel):
    """Wraps TimesFM so it can be logged/registered in MLflow.

    Re-downloads the pretrained weights from Hugging Face by MODEL_ID at load
    time rather than storing them as MLflow artifacts, since they're static
    and multiple GB in size.
    """

    def load_context(self, context):
        self.tfm = timesfm.TimesFM_2p5_200M_torch.from_pretrained(MODEL_ID)
        if hasattr(self.tfm, "compile"):
            self.tfm.compile(
                timesfm.ForecastConfig(
                    max_context=CONTEXT_LEN,
                    max_horizon=FUTURE_PREDICTION_DAYS,
                )
            )

    def predict(self, context, model_input, params=None):
        horizon = model_input.get("horizon", FUTURE_PREDICTION_DAYS) if isinstance(model_input, dict) else FUTURE_PREDICTION_DAYS
        inputs = model_input["inputs"] if isinstance(model_input, dict) else model_input
        return self.tfm.forecast(horizon=horizon, inputs=inputs)


def load_dataset() -> pd.DataFrame:
    df = pd.read_sql("SELECT * FROM dataset ORDER BY date", con=engine)
    if df.empty:
        raise SystemExit("Dataset is empty. Run dataset_creation.py first.")
    df["timestamp"] = pd.to_datetime(df["date"])
    df = df.drop(columns=["id", "date"] + EXCLUDED_COLUMNS, errors="ignore")
    df["id"] = SERIES_ID
    return df.sort_values("timestamp").reset_index(drop=True)


def main():
    print("Loading data from dataset table...")
    df = load_dataset()
    print(f"Loaded {len(df)} rows, {df['timestamp'].min().date()} .. {df['timestamp'].max().date()}.")

    # Context stops the day before the forecast window
    context_cutoff = FUTURE_START_DATE - pd.Timedelta(days=1)
    future_dates = pd.date_range(start=FUTURE_START_DATE, periods=FUTURE_PREDICTION_DAYS, freq="D")

    context_df = df[df["timestamp"] <= context_cutoff].copy()
    if context_df.empty:
        raise SystemExit(f"No data before {context_cutoff.date()} to use as context.")

    future_rows = df[df["timestamp"].isin(future_dates)].set_index("timestamp")

    # Target actuals for backtesting
    if TARGET_COL in future_rows.columns:
        actual = pd.Series(future_dates).map(future_rows[TARGET_COL]).to_numpy()
    else:
        actual = np.full(len(future_dates), np.nan)

    print(f"Context: {len(context_df)} rows through {context_df['timestamp'].max().date()}.")
    print(f"Forecasting {FUTURE_PREDICTION_DAYS} days: {future_dates[0].date()} .. {future_dates[-1].date()}.")

    # Set up MLflow
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
        mlflow.log_param("context_len", CONTEXT_LEN)
        mlflow.log_param("forecast_start", str(future_dates[0].date()))
        mlflow.log_param("forecast_end", str(future_dates[-1].date()))
        mlflow.log_param("approach", "univariate")

        print("Loading Google TimesFM model...")
        
        # Initialize TimesFM 
        # The installed version uses TimesFM_2p5_200M_torch
        try:
            # We use from_pretrained as it's a HuggingFace ModelHubMixin
            tfm = timesfm.TimesFM_2p5_200M_torch.from_pretrained(MODEL_ID)
        except Exception as e:
            if "403" in str(e) or "Forbidden" in str(e):
                print(f"\n[ERREUR] Accès refusé pour télécharger {MODEL_ID}.")
                print("Le modèle TimesFM nécessite d'accepter une licence sur Hugging Face.")
                print(f"1. Allez sur https://huggingface.co/{MODEL_ID}")
                print("2. Acceptez les conditions d'utilisation.")
                print("3. Connectez-vous localement dans votre terminal : huggingface-cli login")
                print("Puis relancez le script.")
                sys.exit(1)
            raise e

        print("Generating %d-day forecast..." % FUTURE_PREDICTION_DAYS)
        # Prepare 1D context data
        context_data = context_df[TARGET_COL].to_numpy()
        input_data = [context_data]
        
        # In TimesFM 2.5, we must configure it before forecasting
        if hasattr(tfm, 'compile'):
            tfm.compile(
                timesfm.ForecastConfig(
                    max_context=CONTEXT_LEN,
                    max_horizon=FUTURE_PREDICTION_DAYS
                )
            )

        # Perform forecasting (TimesFM 2.5 signature)
        forecast_res = tfm.forecast(horizon=FUTURE_PREDICTION_DAYS, inputs=input_data)
        
        # Parse results - TimesFM usually returns (point_forecasts, quantiles)
        if isinstance(forecast_res, tuple) and len(forecast_res) == 2:
            point_forecasts, experimental_quantiles = forecast_res
        else:
            # Fallback if API is different
            point_forecasts = forecast_res
            experimental_quantiles = None

        # Extract the first (and only) series from the batch
        pred_array = point_forecasts[0]

        result_df = pd.DataFrame({
            "date": future_dates,
            "predicted_ene_conso": pred_array,
            "actual_ene_conso": actual,
        })
        
        # Attempt to map standard quantiles if available in output
        # TimesFM often outputs 10 quantiles by default (0.1 to 0.9). We can extract indices 0, 4, 8 for p10, p50, p90.
        if experimental_quantiles is not None:
            q_array = experimental_quantiles[0]  # shape: (horizon_len, num_quantiles)
            if q_array.shape[1] >= 9:
                result_df["p10_ene_conso"] = q_array[:, 0]  # 0.1
                result_df["p50_ene_conso"] = q_array[:, 4]  # 0.5
                result_df["p90_ene_conso"] = q_array[:, 8]  # 0.9
            else:
                # Fallback if structure is unknown
                print("Quantile array structure unknown, skipping standard quantile extraction.")

        # Score against actuals
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
                
            # Quantile loss
            if "p10_ene_conso" in result_df.columns:
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
        output_path = predictions_dir / f"Joule_TimesFM_Energy_Prediction_{run_name}.csv"
        round_cols = [c for c in result_df.columns if c != "date"]
        result_df[round_cols] = result_df[round_cols].round(2)
        result_df.to_csv(output_path, index=False)
        mlflow.log_artifact(str(output_path))
        print(f"\nPredictions saved to {output_path}")

        mlflow.pyfunc.log_model(
            "timesfm_model",
            python_model=TimesFMModel(),
            pip_requirements=["timesfm", "torch", "pandas", "numpy"],
            registered_model_name=REGISTERED_MODEL_NAME,
        )
        print(f"Model logged and registered to MLflow as '{REGISTERED_MODEL_NAME}'.")


if __name__ == "__main__":
    main()
