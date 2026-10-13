"""Transform data/dataset/Final-ByDay.csv into the model-ready dataset.

Steps applied with pandas:
- Nettoyage: drop EcoFlow columns that aren't useful as features (smart plug,
  "for families"/"family needs" duplicates of HomeToLoads, solar-to-grid,
  battery total charging which is redundant with discharging).
- Normalisation: the remaining EcoFlow columns are already in kWh (converted
  upstream by scripts/ecoflow_app_download.py); drop their "_kWh" suffix
  since every value in this dataset is in kWh already.
- Feature engineering: derive daily HP/HC consumption from the cumulative
  Enedis index columns (ENE_HP_ByDay/ENE_HC_ByDay = next day's index minus
  today's), their share of ENE_Conso, and log a warning where HP_ByDay +
  HC_ByDay drifts from ENE_Conso (the two are read from independent meters,
  so they're not expected to match exactly). Also derive ECO_BatteryDiff
  (SolarToBattery minus BatteryTotalDischarging), the net daily change in
  battery state of charge.

Usage (from repo root):
    python scripts/transformation_processing.py [--input data/dataset/Final-ByDay.csv] [--output data/dataset/Transformation-ByDay.csv]
"""

import argparse
import logging
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = REPO_ROOT / "data" / "dataset" / "Final-ByDay.csv"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "dataset" / "Transformation-ByDay.csv"
LOG_DIR = REPO_ROOT / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("transformation_processing")
logger.setLevel(logging.INFO)
_handler = logging.FileHandler(LOG_DIR / "transformation_processing.log", encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(_handler)
logger.addHandler(logging.StreamHandler())

DROP_COLUMNS = [
    "ECO_HomeToSmartPlug_kWh",
    "ECO_HomeSystemForFamilies_kWh",
    "ECO_HomeFamilyNeeds_kWh",
    "ECO_SolarToGrid_kWh",
    "ECO_BatteryTotalCharging_kWh",
    "EAU_Index_Total",
    "TES_WorkKwh"
]

KWH_COLUMNS = [
    "ECO_SolarTotalGeneration_kWh",
    "ECO_SolarToBattery_kWh",
    "ECO_SolarToHome_kWh",
    "ECO_HomeToLoads_kWh",
    "ECO_BatteryTotalDischarging_kWh",
]


def transform(input_path: Path, output_path: Path) -> None:
    df = pd.read_csv(input_path, dtype={"Date": str}).sort_values("Date").reset_index(drop=True)

    df = df.drop(columns=DROP_COLUMNS)

    df = df.rename(columns={c: c.removesuffix("_kWh") for c in KWH_COLUMNS})

    df["ENE_HP_ByDay"] = (df["ENE_Index_HP"].shift(-1) - df["ENE_Index_HP"]).round(4)
    df["ENE_HC_ByDay"] = (df["ENE_Index_HC"].shift(-1) - df["ENE_Index_HC"]).round(4)

    mismatch = (df["ENE_HP_ByDay"] + df["ENE_HC_ByDay"] - df["ENE_Conso"]).abs() > 1
    if mismatch.any():
        logger.warning(f"Attention: {mismatch.sum()} jours ou HP_ByDay + HC_ByDay s'ecarte de ENE_Conso de plus de 1 kWh")

    df["ENE_HP_Percent"] = (df["ENE_HP_ByDay"] / df["ENE_Conso"]).round(4)
    df["ENE_HC_Percent"] = (df["ENE_HC_ByDay"] / df["ENE_Conso"]).round(4)

    df["ECO_BatteryDiff"] = (df["ECO_SolarToBattery"] - df["ECO_BatteryTotalDischarging"]).round(4)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    logger.info(f"Ecrit: {output_path} ({len(df)} jours, {len(df.columns)} colonnes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    transform(args.input, args.output)
