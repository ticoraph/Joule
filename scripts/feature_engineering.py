"""
Feature Engineering Script
--------------------------
This script calculates advanced metrics and features based on the primary raw data
stored in the `daily_readings` table. It performs calculations like linear regression
for expected solar yield and actual performance residuals.

The results are stored in the `feature_engineering` table, maintaining a 1:1
relationship with `daily_readings` via the `date` column.

This script should be run periodically (e.g., via cron) or as part of a data pipeline
after new raw readings have been imported.
"""

import math
import sys
from pathlib import Path

# Add backend directory to sys.path so we can import from app
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.db import SessionLocal, engine
from app.models import Base, DailyReading, FeatureEngineering


def calculate_regression(points: list[tuple[float, float]]) -> tuple[float, float]:
    """
    Computes a simple linear regression (y = a*x + b).
    
    Args:
        points: A list of (x, y) tuples.
        
    Returns:
        A tuple of (a, b) where 'a' is the slope and 'b' is the intercept.
    """
    n = len(points)
    if n == 0:
        return 0.0, 0.0
    
    sum_x = sum(x for x, _ in points)
    sum_y = sum(y for _, y in points)
    mean_x = sum_x / n
    mean_y = sum_y / n
    
    num = sum((x - mean_x) * (y - mean_y) for x, y in points)
    den = sum((x - mean_x) ** 2 for x, _ in points)
    
    a = num / den if den != 0 else 0.0
    b = mean_y - a * mean_x
    
    return a, b


def run_feature_engineering():
    """
    Main execution function.
    Reads data, calculates features, and upserts them to the database.
    """
    print("Ensuring `feature_engineering` table exists...")
    Base.metadata.create_all(bind=engine)
    
    db: Session = SessionLocal()
    try:
        print("Fetching daily readings for analysis...")
        readings = db.execute(select(DailyReading)).scalars().all()
        
        # Prepare points for linear regression (EcoFlow solar vs sunshine duration)
        regression_points = []
        for r in readings:
            if r.eco_solartotalgeneration is not None and r.sun_daylight_minute is not None and r.sun_daylight_minute > 0:
                regression_points.append((r.sun_daylight_minute, r.eco_solartotalgeneration))
        
        # Calculate expected trend line
        a, b = calculate_regression(regression_points)
        print(f"Computed linear regression: expected_production = {a:.4f} * sun_minutes + {b:.4f}")
        
        # Pre-fetch existing feature engineering rows for upsert logic
        existing_rows = {
            row.date: row for row in db.execute(select(FeatureEngineering)).scalars().all()
        }
        
        upsert_count = 0
        insert_count = 0
        
        for r in readings:
            prod = r.eco_solartotalgeneration
            sun_min = r.sun_daylight_minute
            
            yield_kwh_per_h = None
            residual = None
            
            if prod is not None and sun_min is not None and sun_min > 0:
                # Rendement: kWh produced per hour of theoretical daylight
                yield_kwh_per_h = prod / (sun_min / 60.0)
                
                # Residual: Actual production minus the expected production (from trend)
                expected = a * sun_min + b
                residual = prod - expected

            hc_net_per_hp_ratio = None
            if r.ene_hc_byday is not None and r.ene_hp_byday is not None and r.ene_hp_byday > 0:
                tes_home = r.tes_homekwh or 0.0
                hc_net = max(0.0, r.ene_hc_byday - tes_home)
                hc_net_per_hp_ratio = hc_net / r.ene_hp_byday

            amplitude_tmax_min = None
            if r.cli_tempmax is not None and r.cli_tempmin is not None:
                amplitude_tmax_min = r.cli_tempmax - r.cli_tempmin

            ene_conso_withouttesla = None
            if r.ene_conso is not None:
                ene_conso_withouttesla = r.ene_conso - (r.tes_homekwh or 0.0)

            eco_ratio_solarperconsototal = None
            if ene_conso_withouttesla is not None and r.eco_hometoloads is not None:
                total_conso = ene_conso_withouttesla + r.eco_hometoloads
                if total_conso != 0:
                    eco_ratio_solarperconsototal = r.eco_hometoloads / total_conso

            # Upsert into FeatureEngineering
            fe_row = existing_rows.get(r.date)
            if fe_row:
                fe_row.eco_kwh_per_daylighthour = yield_kwh_per_h
                fe_row.eco_actual_prod_minus_expected = residual
                fe_row.ene_hcwithoutesla_to_hp_ratio = hc_net_per_hp_ratio
                fe_row.cli_amplitude_tmax_min = amplitude_tmax_min
                fe_row.ene_conso_withouttesla = ene_conso_withouttesla
                fe_row.eco_ratio_solarperconsototal = eco_ratio_solarperconsototal
                upsert_count += 1
            else:
                new_fe = FeatureEngineering(
                    date=r.date,
                    eco_kwh_per_daylighthour=yield_kwh_per_h,
                    eco_actual_prod_minus_expected=residual,
                    ene_hcwithoutesla_to_hp_ratio=hc_net_per_hp_ratio,
                    cli_amplitude_tmax_min=amplitude_tmax_min,
                    ene_conso_withouttesla=ene_conso_withouttesla,
                    eco_ratio_solarperconsototal=eco_ratio_solarperconsototal
                )
                db.add(new_fe)
                insert_count += 1
                
        db.commit()
        print(f"Successfully processed {len(readings)} days.")
        print(f"Inserted: {insert_count}, Updated: {upsert_count}")
        
    except Exception as e:
        db.rollback()
        print(f"Error during feature engineering: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run_feature_engineering()
