"""Prefect flow for README.md "Pipeline: run order" steps 3-8, run locally without a Prefect server.

Each task shells out to the same scripts as orchestration/Makefile (`make pipeline` / `make train` /
`make predict-prod` / `make analyze`), using the *main* repo venv (`.venv`) where
pandas/xgboost/mlflow/etc are installed - not this `orchestration/.venv`, which only
needs `prefect` itself.

Usage (from repo root, with orchestration/.venv active or via its python directly):
    orchestration/.venv/bin/python orchestration/flow.py                      # steps 3-5 (data only)
    orchestration/.venv/bin/python orchestration/flow.py --train              # step 6
    orchestration/.venv/bin/python orchestration/flow.py --predict-prod \\
        --model Joule_Chronos2_Energy_Prediction --version 6                  # step 7
    orchestration/.venv/bin/python orchestration/flow.py --analyze            # step 8

See orchestration/README.md for setup and the monthly runbook.
"""

import argparse
import subprocess
import sys
from pathlib import Path

from prefect import flow, task

REPO_ROOT = Path(__file__).resolve().parent.parent
PYTHON = REPO_ROOT / ".venv" / "bin" / "python"


def run_script(*args: str) -> None:
    subprocess.run([str(PYTHON), *args], cwd=REPO_ROOT, check=True)


@task
def process():
    run_script("scripts/final_processing.py")


@task
def transform():
    run_script("scripts/transformation_processing.py")


@task
def import_data():
    run_script("scripts/import_csv.py")


@task
def features():
    run_script("scripts/feature_engineering.py")


@task
def dataset():
    run_script("scripts/dataset_creation.py")


@task
def train_xgboost():
    run_script("mlflow/train_xgboost.py")


@task
def train_timesfm():
    run_script("mlflow/train_timesfm.py")


@task
def train_chronos2():
    run_script("mlflow/train_chronos2.py")


@task
def train_average():
    run_script("scripts/model_average.py")


@task
def train_prophet():
    run_script("mlflow/train_prophet.py")


@task
def predict_prod(model: str, version: int):
    run_script("mlflow/predict_prod.py", "--model", model, "--version", str(version))


@task
def analyze():
    run_script("scripts/analysis_llm.py")


@flow(name="joule-pipeline")
def pipeline_flow():
    """Steps 3-5: build the flat dataset, load it into SQLite, rebuild the training `dataset` table."""
    process()
    transform()
    import_data()
    features()
    dataset()


@flow(name="joule-train")
def train_flow():
    """Step 6: train/backtest every model against the `dataset` table."""
    # independent - run concurrently
    futures = [
        train_xgboost.submit(),
        train_timesfm.submit(),
        train_chronos2.submit(),
        train_average.submit(),
        train_prophet.submit(),
    ]
    for f in futures:
        f.result()


@flow(name="joule-predict-prod")
def predict_prod_flow(model: str, version: int):
    """Step 7: promote a model/version and generate the production forecast."""
    predict_prod(model, version)


@flow(name="joule-analyze")
def analyze_flow():
    """Step 8: LLM analysis of the backtest CSVs."""
    analyze()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", action="store_true", help="Run step 6 instead of steps 3-5")
    parser.add_argument("--predict-prod", action="store_true", help="Run step 7 instead of steps 3-5")
    parser.add_argument("--model", default="Joule_Chronos2_Energy_Prediction")
    parser.add_argument("--version", type=int, default=6)
    parser.add_argument("--analyze", action="store_true", help="Run step 8 instead of steps 3-5")
    args = parser.parse_args()

    if args.train + args.predict_prod + args.analyze > 1:
        sys.exit("--train, --predict-prod and --analyze are mutually exclusive")

    if args.train:
        train_flow()
    elif args.predict_prod:
        predict_prod_flow(args.model, args.version)
    elif args.analyze:
        analyze_flow()
    else:
        pipeline_flow()
