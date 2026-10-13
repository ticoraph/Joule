import sys
from pathlib import Path
import pandas as pd
import numpy as np
from sqlalchemy import text

# Add backend directory to sys.path so we can import from app
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.core.db import engine
from app.models import Base

def create_dataset():
    """
    Fetches data from daily_readings and feature_engineering starting from 2022-01-01,
    computes temporal features, and saves it into the `dataset` table for XGBOOST modeling.
    """
    print("Dropping `dataset` table if it exists to refresh schema...")
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS dataset"))
        
    print("Ensuring `dataset` table exists...")
    Base.metadata.create_all(bind=engine)
    
    query = """
    SELECT 
        dr.date,
        fe.cli_amplitude_tmax_min,
        dr.cli_precip,
        dr.cli_tempmoy,
        fe.eco_kwh_per_daylighthour,
        fe.eco_actual_prod_minus_expected,
        fe.eco_ratio_solarperconsototal,
        dr.ene_conso,
        fe.ene_conso_withouttesla,
        dr.ene_hc_byday,
        dr.ene_hp_byday,
        dr.ene_pmax,
        fe.ene_hcwithoutesla_to_hp_ratio,
        dr.tes_homekwh,
        dr.sun_daylight_minute
    FROM daily_readings dr
    LEFT JOIN feature_engineering fe ON dr.date = fe.date
    WHERE dr.date >= '2022-01-01' AND dr.date <= '2026-06-30'
    """

    print("Loading data from database...")
    df = pd.read_sql(query, con=engine)

    if df.empty:
        print("No data found from 2022-01-01 onwards. Exiting.")
        return

    print(f"Loaded {len(df)} rows. Applying feature engineering...")

    # Ensure date is datetime
    df['date'] = pd.to_datetime(df['date'])
    
    # Temporal Features
    df['date_dayofweek'] = df['date'].dt.dayofweek
    df['date_quarter'] = df['date'].dt.quarter
    df['date_month'] = df['date'].dt.month
    df['date_year'] = df['date'].dt.year
    df['date_dayofyear'] = df['date'].dt.dayofyear
    df['date_dayofmonth'] = df['date'].dt.day
    df['date_weekofyear'] = df['date'].dt.isocalendar().week.astype(int)
    
    # is_weekend: 1 if Saturday (5) or Sunday (6), else 0
    df['date_is_weekend'] = df['date_dayofweek'].apply(lambda x: 1 if x >= 5 else 0)
    
    # Cyclical encoding for day of week (7 days) and month (12 months)
    df['date_sin_dayofweek'] = np.sin(2 * np.pi * df['date_dayofweek'] / 7)
    df['date_cos_dayofweek'] = np.cos(2 * np.pi * df['date_dayofweek'] / 7)
    
    df['date_sin_month'] = np.sin(2 * np.pi * df['date_month'] / 12)
    df['date_cos_month'] = np.cos(2 * np.pi * df['date_month'] / 12)
    
    # Format the date column as YYYY-MM-DD
    df['date'] = df['date'].dt.strftime('%Y-%m-%d')

    # Sort columns alphabetically, keeping 'date' first
    other_cols = sorted(c for c in df.columns if c != 'date')
    df = df[['date'] + other_cols]

    print("Saving to dataset table...")
    
    # Insert new data
    df.to_sql('dataset', con=engine, if_exists='append', index=False)
    print(f"Dataset successfully created in table 'dataset' with {len(df)} rows and {len(df.columns)} columns.")

if __name__ == "__main__":
    create_dataset()
