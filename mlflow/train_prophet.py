"""
Forecasts daily electricity consumption (ene_conso) with Facebook Prophet,
following a univariate approach based on the existing scripts structure.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import mlflow
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

try:
    from prophet import Prophet
except ImportError:
    print(
        "Warning: 'prophet' library not found. "
        "Please install with 'pip install prophet'."
    )
    sys.exit(1)

# Add backend directory to sys.path so we can import from app
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.core.db import engine

REGISTERED_MODEL_NAME = "Joule_Prophet_Energy_Prediction"

SERIES_ID = "joule"
TARGET_COL = "ene_conso_withouttesla"

FUTURE_START_DATE = pd.Timestamp("2026-04-01")
FUTURE_PREDICTION_DAYS = 90

EXCLUDED_COLUMNS = [
    "date_dayofweek", "date_quarter", "date_month", "date_year",
    "date_dayofmonth", "date_weekofyear",
    "cli_precip", "eco_actual_prod_minus_expected",
    "ene_conso", "tes_homekwh",
]


class ProphetModel(mlflow.pyfunc.PythonModel):
    """Wraps Prophet so it can be logged/registered in MLflow."""
    def load_context(self, context):
        import joblib
        self.model = joblib.load(context.artifacts["model"])

    def predict(self, context, model_input, params=None):
        horizon = model_input.get("horizon", FUTURE_PREDICTION_DAYS) if isinstance(model_input, dict) else FUTURE_PREDICTION_DAYS
        future = self.model.make_future_dataframe(periods=horizon)
        # return only the future rows
        forecast = self.model.predict(future)
        return forecast.tail(horizon)


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

        mlflow.log_param("prediction_length", FUTURE_PREDICTION_DAYS)
        mlflow.log_param("forecast_start", str(future_dates[0].date()))
        mlflow.log_param("forecast_end", str(future_dates[-1].date()))
        mlflow.log_param("approach", "univariate")
        mlflow.log_param("model", "prophet")

        print("Training Prophet model...")
        
        # Prepare data for Prophet (requires 'ds' and 'y' columns)
        train_df = pd.DataFrame({
            'ds': context_df['timestamp'],
            'y': context_df[TARGET_COL]
        })
        
        # Initialize and fit Prophet
        m = Prophet(interval_width=0.80) # 80% interval -> p10 to p90
        m.fit(train_df)

        print("Generating %d-day forecast..." % FUTURE_PREDICTION_DAYS)
        
        # Create future dataframe
        future = m.make_future_dataframe(periods=FUTURE_PREDICTION_DAYS)
        forecast = m.predict(future)
        
        # Extract the forecasted part
        forecast_window = forecast.tail(FUTURE_PREDICTION_DAYS).reset_index(drop=True)

        result_df = pd.DataFrame({
            "date": future_dates,
            "predicted_ene_conso": forecast_window['yhat'].to_numpy(),
            "actual_ene_conso": actual,
            "p10_ene_conso": forecast_window['yhat_lower'].to_numpy(),
            "p50_ene_conso": forecast_window['yhat'].to_numpy(),
            "p90_ene_conso": forecast_window['yhat_upper'].to_numpy(),
        })

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
        output_path = predictions_dir / f"Joule_Prophet_Energy_Prediction_{run_name}.csv"
        round_cols = [c for c in result_df.columns if c != "date"]
        result_df[round_cols] = result_df[round_cols].round(2)
        result_df.to_csv(output_path, index=False)
        mlflow.log_artifact(str(output_path))
        print(f"\nPredictions saved to {output_path}")

        # Save model using joblib and log as artifact for pyfunc
        import joblib
        import tempfile
        import os
        
        with tempfile.TemporaryDirectory() as tmp_dir:
            model_path = os.path.join(tmp_dir, "prophet_model.pkl")
            joblib.dump(m, model_path)
            
            mlflow.pyfunc.log_model(
                "prophet_model",
                python_model=ProphetModel(),
                artifacts={"model": model_path},
                pip_requirements=["prophet", "pandas", "numpy", "joblib"],
                registered_model_name=REGISTERED_MODEL_NAME,
            )
        print(f"Model logged and registered to MLflow as '{REGISTERED_MODEL_NAME}'.")


if __name__ == "__main__":
    main()
