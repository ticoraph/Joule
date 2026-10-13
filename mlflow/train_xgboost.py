import sys
import os
from pathlib import Path
import pandas as pd
import numpy as np
import xgboost as xgb
import mlflow
import mlflow.xgboost
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

# Add backend directory to sys.path so we can import from app
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.core.db import engine

def main():
    print("Loading data from dataset table...")
    df = pd.read_sql("SELECT * FROM dataset ORDER BY id", con=engine)
    
    # Check if empty
    if df.empty:
        print("Dataset is empty. Run dataset_creation.py first.")
        return
        
    print(f"Loaded {len(df)} rows.")

    # Target variable
    target_col = 'ene_conso_withouttesla'

    # Drop rows where target is NaN
    df = df.dropna(subset=[target_col])

    # Simple temporal split: train on everything up to 2026-03-31, test on
    # the following quarter (2026-04-01 to 2026-06-30).
    dates = pd.to_datetime(df['date'])
    train_end = pd.Timestamp('2026-03-31')
    test_start = pd.Timestamp('2026-04-01')
    test_end = pd.Timestamp('2026-06-30')
    train_mask = dates <= train_end
    test_mask = (dates >= test_start) & (dates <= test_end)

    # Keep dates for the test set before dropping the 'date' column
    test_dates = dates.loc[test_mask]

    # Drop target-leaking columns, id, and non-numeric date
    leaky_columns = [
        'ene_hc_byday', 
        'ene_hp_byday', 
        'ene_hcwithoutesla_to_hp_ratio', 
        'ene_conso', 
        'tes_homekwh',
        'eco_ratio_solarperconsototal', 
        'ene_pmax']
    cols_to_drop = leaky_columns + ['id', 'date']
    df = df.drop(columns=[col for col in cols_to_drop if col in df.columns])

    train_df = df.loc[train_mask].copy()
    test_df = df.loc[test_mask].copy()

    X_train = train_df.drop(columns=[target_col])
    y_train = train_df[target_col]
    X_test = test_df.drop(columns=[target_col])
    y_test = test_df[target_col]

    print(f"Train size: {len(train_df)}, Test size: {len(test_df)}")

    # Set up MLflow
    # Use the MLflow server running in Docker
    mlflow.set_tracking_uri("http://localhost:5001")
    
    experiment_name = "Joule"
    experiment = mlflow.get_experiment_by_name(experiment_name)
    if experiment is None:
        mlflow.create_experiment(experiment_name)
    mlflow.set_experiment(experiment_name)
    
    # Train model
    with mlflow.start_run() as run:
        run_name = run.info.run_name
        # Log datasets
        train_dataset = mlflow.data.from_pandas(train_df, targets=target_col, name="training_dataset")
        test_dataset = mlflow.data.from_pandas(test_df, targets=target_col, name="testing_dataset")
        mlflow.log_input(train_dataset, context="training")
        mlflow.log_input(test_dataset, context="testing")

        print("Training XGBoost model with default hyperparameters...")
        model = xgb.XGBRegressor(objective='reg:squarederror', random_state=42)
        model.fit(X_train, y_train)
        
        # Log parameters
        mlflow.log_params(model.get_params())
        mlflow.log_param("split_strategy", "temporal_2026-03-31_cutoff")
        
        # Predict on test
        preds = model.predict(X_test)
        
        # Calculate metrics
        rmse = np.sqrt(mean_squared_error(y_test, preds))
        mae = mean_absolute_error(y_test, preds)
        r2 = r2_score(y_test, preds)
        
        print(f"Metrics - RMSE: {rmse:.4f}, MAE: {mae:.4f}, R2: {r2:.4f}")
        
        # Log metrics and model
        mlflow.log_metric("rmse", rmse)
        mlflow.log_metric("mae", mae)
        mlflow.log_metric("r2", r2)
        
        # Infer signature
        from mlflow.models.signature import infer_signature
        signature = infer_signature(X_test, preds)
        
        mlflow.xgboost.log_model(
            model, 
            "xgboost_model", 
            signature=signature,
            input_example=X_test.iloc[:5],
            registered_model_name="Joule_XGBoost_Energy_Predictor"
        )
        print("Model logged and registered to MLflow successfully.")
        
    # Build the predictions CSV directly from the test-set predictions above
    result_df = pd.DataFrame({
        'date': test_dates.values,
        'predicted_ene_conso': preds,
        'actual_ene_conso': y_test.values,
    })
    result_df['predicted_ene_conso'] = result_df['predicted_ene_conso'].round(2)
    result_df['actual_ene_conso'] = result_df['actual_ene_conso'].round(2)

    print("\nSample of test predictions:")
    print(result_df.head(10))

    # Save to CSV
    predictions_dir = Path(__file__).resolve().parent.parent / "data" / "predictions"
    predictions_dir.mkdir(parents=True, exist_ok=True)
    output_path = predictions_dir / f"Joule_XGBoost_Energy_Prediction_{run_name}.csv"
    result_df.to_csv(output_path, index=False)
    print(f"\nPredictions saved to {output_path}")

if __name__ == "__main__":
    main()
