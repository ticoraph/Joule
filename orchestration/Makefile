.PHONY: pipeline process transform import features dataset \
        train train-xgboost train-timesfm train-chronos2 train-average train-prophet \
        predict-prod analyze

# This Makefile lives in orchestration/ but every script is run from the repo root,
# so it works the same via `make -C orchestration <target>` or `cd orchestration && make <target>`.
REPO_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))..)
RUN := cd $(REPO_ROOT) && .venv/bin/python

# Steps 3-5 of README.md "Pipeline: run order" (data only - training is `make train`): no interactive auth needed
# (assumes data/raw/ and data/processed/ are already up to date - see the README
# pipeline steps 1-2 for the per-source download/merge scripts, several of which need manual login).
pipeline: process transform import features dataset

process:
	$(RUN) scripts/final_processing.py

transform:
	$(RUN) scripts/transformation_processing.py

import:
	$(RUN) scripts/import_csv.py

features:
	$(RUN) scripts/feature_engineering.py

dataset:
	$(RUN) scripts/dataset_creation.py

# Step 6: requires `mlflow server` reachable at http://localhost:5001
train: train-xgboost train-timesfm train-chronos2 train-average train-prophet

train-xgboost:
	$(RUN) mlflow/train_xgboost.py

train-timesfm:
	$(RUN) mlflow/train_timesfm.py

train-chronos2:
	$(RUN) mlflow/train_chronos2.py

train-average:
	$(RUN) scripts/model_average.py

train-prophet:
	$(RUN) mlflow/train_prophet.py

# Step 7: manual promotion decision - pass the model/version to promote, e.g.
#   make -C orchestration predict-prod MODEL=Joule_Chronos2_Energy_Prediction VERSION=7
MODEL ?= Joule_Chronos2_Energy_Prediction
VERSION ?= 6
predict-prod:
	$(RUN) mlflow/predict_prod.py --model $(MODEL) --version $(VERSION)

# Step 8
analyze:
	$(RUN) scripts/analysis_llm.py
