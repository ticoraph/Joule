# Joule

Electricity consumption platform: import daily consumption/index/peak-power data, visualize trends, and (later) forecast future consumption with machine learning.


> **Try it without any personal data:** `python scripts/make_sample_data.py` generates a synthetic dataset
> (4.5 years of fake daily readings) into `data/joule.db`. The author's real data is not part of this repository.

## Features

- **Dashboard**: KPIs (total/average consumption, peak power) and a monthly consumption chart.
- **Consumption**: daily consumption and peak power (PMax) charts.
- **EcoFlow / Enedis / Tesla**: per-source detail dashboards (solar/battery, meter index/peak power,
  vehicle charging).
- **Cost**: cost breakdown across sources.
- **Climat**: daily temperature/precipitation trends plus a yearly Été/Hiver seasonal comparison chart.
- **Feature Engineering**: client-side Pearson correlation matrix and a server-trained XGBoost
  feature-importance chart (selectable target variable) over the derived metrics.
- **Database**: raw table dump viewer.
- **Predictions**: per-model backtest comparison (Chronos2 / TimesFM / XGBoost / Prophet / Average, with
  MAE/RMSE/bias/MAPE) plus a production forecast chart with p10/p90 uncertainty bands.
- **Analyse LLM**: a locally-run Qwen3-4B (GGUF) report comparing the backtests, flagging anomalies, and
  explaining errors in French — pre-generated offline, served as a read-only page.

## Tech stack

- **Backend**: FastAPI + SQLAlchemy 2.0 + SQLite (local) / PostgreSQL (production)
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + React Query + Recharts
- **Infrastructure**: Cloud Run, Artifact Registry, IAM and a private GCS data bucket, managed in a separate private Terraform repo (project `tnera-prod`, region `europe-west4`). This repo owns app code, `firebase.json`/`.firebaserc` for Firebase Hosting, and its own deploy workflow that builds/deploys the API, an MLflow tracking server, and the SPA — see [Deployment](#deployment) below.
- **Auth**: Firebase Auth (Google Sign-In), enforced by an email allowlist verified server-side

## Local startup

1. **Google Cloud Auth**: You need your GCP credentials locally to verify Firebase tokens.
   ```bash
   gcloud auth application-default login
   gcloud auth application-default set-quota-project tnera-prod
   ```
2. **Environment Variables**:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
   *Note: Ensure you add `ALLOWED_EMAILS=["votre.email@gmail.com"]` in `backend/.env`!*
3. **Start Docker**:
   ```bash
   docker compose up -d
   ```

- Frontend: <http://localhost:5177>
- API: <http://localhost:8001> (`/health`, `/docs`)

## Managing Authorized Users

Access is strictly controlled by an email allowlist. Anyone not on this list will be rejected by the API with a 403 Forbidden error and logged out automatically by the frontend. The value must be a valid JSON array of strings.

- **Local Development**: Update the `ALLOWED_EMAILS` variable in your `backend/.env` file.
  ```env
  ALLOWED_EMAILS=[""]
  ```
  Then restart the API container: `docker restart joule-api-1`
- **Production**: Update the environment variable for the Cloud Run service.
  - Via Google Cloud Console: Cloud Run > `tnera-joule` > Edit & Deploy New Revision > Variables & Secrets > update `ALLOWED_EMAILS`.
  - Via gcloud CLI: 
    ```bash
    gcloud run services update tnera-joule --region europe-west4 --update-env-vars ALLOWED_EMAILS='[""]'
    ```

## Data pipeline

Raw exports live in `data/raw/`, get merged into one CSV per source in `data/processed/`,
`scripts/final_processing.py` combines all of those into a single outer-joined file, and
`scripts/transformation_processing.py` cleans/derives features from it into the model-ready file in
`data/dataset/`.

```
data/raw/        scraped/exported files (xlsx, html-derived csv, mitmproxy captures, one per fetch)
data/processed/  one merged, deduped CSV per source (ENE_/ECO_/CLI_/TES_/AQR_/EAU_ByDay.csv)
data/dataset/    Final-ByDay.csv - all sources outer-joined on date
                 Transformation-ByDay.csv - cleaned/feature-engineered, for ML training/predictions
```

Install script dependencies first: `pip install -r scripts/requirements.txt`.

### Enedis (consumption, meter index, peak power)
```bash
python scripts/enedis_download.py --login    # one-time: opens a browser, log in manually, saves session
python scripts/enedis_download.py            # downloads this year's exports to data/raw/
python scripts/enedis_download.py --year 2025  # or backfill a specific past year
python scripts/enedis_xlsx_to_csv.py          # converts the latest data/raw/*.xlsx to csv
python scripts/enedis_merge_csv.py            # merges them into data/processed/ENE_ByDay.csv
```

### EcoFlow (solar/home/battery daily energy totals)

`scripts/ecoflow_app_download.py` replays a captured EcoFlow app session token against its private
pre-aggregated daily-totals endpoint - no polling needed, but the token expires ~30 days after login
and must be recaptured via mitmproxy. The script reads the token/`groupId` directly from a mitmproxy
capture (`data/mitmproxy/ecoflow_flows` by default, same as Tesla) - no manual copy/paste. `scripts/mitm_capture.sh ecoflow` walks through the capture.

```bash
python scripts/ecoflow_app_download.py --date 2026-06-23
python scripts/ecoflow_app_download.py --start 2026-06-01 --end 2026-06-23
```

Writes `data/processed/ECO_ByDay.csv`, columns prefixed `ECO_` and suffixed `_kWh`.

### Tesla (vehicle charging energy/cost)

No public Fleet API exposes charge history, so this replays a manual mitmproxy capture of the Tesla
app's traffic instead (`scripts/mitm_capture.sh tesla` walks through the capture).

```bash
python scripts/tesla_parse_charge_history.py
python scripts/tesla_parse_charge_history.py --capture data/mitmproxy/tesla_flows --out data/raw/tesla_charge_history.csv
```

Writes the full day+month detail to `data/raw/tesla_charge_history.csv` and a day-granularity,
kWh-converted `data/processed/TES_ByDay.csv`, columns prefixed `TES_`.

### Aqara (indoor/outdoor temperature, smart-plug power)

No auth needed - reads directly out of the Aqara Home macOS app's local SQLite cache, so the app must
have been opened at least once (and the more date ranges viewed in its charts, the more history ends up
in the cache).

```bash
python scripts/aqara_download_app.py
```

Merges into `data/processed/AQR_ByDay.csv`, one column per device, prefixed `AQR_`.

### Eau (Grand Chambéry water meter)

The portal only retains the 5 most recent readings and has no export button, so this scrapes the
readings table's DataTables instance directly.

```bash
python scripts/water_download.py --login    # one-time manual login, saves session
python scripts/water_download.py            # scrapes the readings table to data/raw/
python scripts/eau_merge_csv.py             # spreads yearly readings into a daily series
```

Since the meter is only read ~once a year, `eau_merge_csv.py` spreads each interval's total consumption
across its days using a smoothed seasonal profile, into `data/processed/EAU_ByDay.csv`, columns
prefixed `EAU_`.

### Climat (daily temperature/precipitation for Chambéry)

No login needed - reads the daily series straight out of infoclimat.fr's yearly chart data:

```bash
python scripts/infoclimat_download.py                              # 2022 -> current year
python scripts/infoclimat_download.py --start-year 2024 --end-year 2025
```

Writes `data/raw/infoclimat_<station-id>_<year>_byday.csv` per year and merges them into
`data/processed/CLI_ByDay.csv`.

### Final dataset

```bash
python scripts/final_processing.py
python scripts/transformation_processing.py
```

Outer-joins every `data/processed/*-ByDay.csv` on a normalized `YYYYMMDD` date into
`data/dataset/Final-ByDay.csv`, then `transformation_processing.py` cleans it up (drops unused EcoFlow
columns, drops the now-redundant `_kWh` suffix since every value in the dataset is in kWh, derives daily
HP/HC consumption and shares) into `data/dataset/Transformation-ByDay.csv` - the file used for import and
ML training/predictions.

## Pipeline: run order

All commands run from the repo root with the venv from `scripts/requirements.txt` active. Every script is
idempotent, so re-running a step (or the whole pipeline) is safe.

```bash
# 1. Download raw data (per source, into data/raw/) — run whichever you need fresh
python3 scripts/enedis_download.py            # --login once, then normal runs
python3 scripts/ecoflow_app_download.py        # needs a fresh app capture (scripts/mitm_capture.sh)
python3 scripts/aqara_download_app.py          # reads the local Aqara app cache, no network
python3 scripts/water_download.py              # --login once; ~yearly cadence
python3 scripts/infoclimat_download.py         # no auth
python3 scripts/tesla_parse_charge_history.py  # replays a manual mitmproxy capture

# 2. Convert / merge into data/processed/*-ByDay.csv (the other sources write there directly)
python3 scripts/enedis_xlsx_to_csv.py && python3 scripts/enedis_merge_csv.py
python3 scripts/eau_merge_csv.py

# 3. Build the flat dataset
python3 scripts/final_processing.py && python3 scripts/transformation_processing.py

# 4. Load into the database (SQLite locally)
python3 scripts/import_csv.py && python3 scripts/feature_engineering.py

# 5. (Before training only) rebuild the `dataset` table
python3 scripts/dataset_creation.py

# 6. Train / backtest each model (needs `mlflow server` on http://localhost:5001) -> data/predictions/
python3 mlflow/train_xgboost.py && python3 mlflow/train_timesfm.py && python3 mlflow/train_chronos2.py
python3 mlflow/train_prophet.py && python3 scripts/model_average.py

# 7. Promote one model version to Production and write the future forecast (a deliberate, manual choice)
python3 mlflow/predict_prod.py --model Joule_Chronos2_Energy_Prediction --version <n>

# 8. (Optional) local-LLM analysis of the backtests
python3 scripts/analysis_llm.py                # --dry-run prints the prompt only
```

No data of your own? `python scripts/make_sample_data.py` fills `data/joule.db` with a synthetic dataset
and runs steps 4–5 for you. Step 7 is written for Chronos-2's pyfunc signature; passing an XGBoost or
TimesFM version won't produce a correct forecast without changes to the script.

Steps 3–6 and 8 have no interactive auth and are chained by `orchestration/Makefile`
(`make -C orchestration pipeline | train | predict-prod MODEL=… VERSION=… | analyze`) and by the Prefect flow
`orchestration/flow.py` (own venv, no Prefect server) — see [orchestration/README.md](orchestration/README.md).
Steps 1–2 stay manual: several sources need a saved login session or a fresh mitmproxy capture.

## Importing CSV data into the database

Run from the repo root, with `backend/`'s dependencies installed and `DATABASE_URL` pointed at your database (SQLite by default: `sqlite:///data/joule.db`; PostgreSQL in production):
```bash
python scripts/import_csv.py
```
Self-adapting and idempotent: any CSV column without a matching `daily_readings` column gets added on
the fly, and existing values are never overwritten - only new dates get inserted and still-NULL columns
of existing dates get filled in.

In production the database is Cloud SQL PostgreSQL (`DATABASE_URL` from Secret Manager). The real data is not in this repository; the deploy workflow still pulls `data/` (predictions, LLM reports) from a private GCS bucket (repo variable `GCP_DATA_BUCKET`). To load new data into production, point `scripts/import_csv.py` at the production database through the Cloud SQL Auth Proxy, or copy a local SQLite file with `python -m app.db_copy` (see its docstring).

## Feature engineering

`scripts/feature_engineering.py` reads `daily_readings` and computes derived metrics (solar yield per
hour of sunshine, performance residual vs. a linear-regression trend, HC-net-of-Tesla/HP ratio, daily
thermal amplitude), writing them 1:1 by date into the `feature_engineering` table:
```bash
python scripts/feature_engineering.py
```
Run it after `import_csv.py` whenever new raw readings land. These columns power the Feature Engineering
page's correlation matrix and its `GET /api/readings/feature-importance` XGBoost endpoint.

## Predictions & MLflow

`mlflow/` holds the model-training side of the Predictions page. Ordered command reference: [Pipeline: run order](#pipeline-run-order).

- **Tracking server**: MLflow, backed by `mlflow/mlflow.db` (SQLite) and `mlflow/artifacts/` — both
  gitignored and created on first run. The deployed server starts with an empty registry.
  Runs locally at <http://localhost:5001> (`docker compose up`) and is also deployed to its own Cloud Run
  service, reachable in production at `/mlflow` on the app's public hostname via the Firebase Hosting rewrite in
  `firebase.json`.
- **`scripts/dataset_creation.py`**: drops/rebuilds a `dataset` table from `daily_readings` +
  `feature_engineering` (2022-01-01 onward) with added temporal/cyclical features — the table every
  training script below trains/backtests against. Re-run after new data lands, before retraining.
- **Training/forecasting scripts** (`mlflow/train_xgboost.py`, `train_timesfm.py` (zero-shot),
  `train_chronos2.py` (zero-shot), `train_prophet.py`, and `scripts/model_average.py` — a naive
  day-of-year seasonal average, not MLflow-tracked) are run manually against the `dataset` table, logging
  params/metrics/models to the tracking server and writing a backtest CSV to
  `data/predictions/Joule_{name}_*.csv`. None are triggered by CI or any endpoint.
- **`mlflow/predict_prod.py --model ... --version ...`**: promotes the given registered model version to
  `Production` in the MLflow registry (archiving whatever was staged before) and writes a forecast (with
  p10/p90 bands) to `data/predictions/prediction_prod_{model}_*.csv`. Which model/version to promote is a
  manual decision based on the backtest metrics above.
- **`scripts/analysis_llm.py`**: loads a local Qwen3-4B GGUF model (`models/`, downloaded on first run,
  see [models/README.md](models/README.md)) via `llama-cpp-python` and writes a French-language JSON
  report analyzing the latest backtest CSVs, to `data/llm_reports/`. Run manually/offline.
- **Orchestration**: `orchestration/Makefile` (`make -C orchestration pipeline`, `train`, `predict-prod`,
  `analyze`) and `orchestration/flow.py` (a Prefect flow, run from its own venv per
  `orchestration/requirements.txt` so installing Prefect can't upgrade shared deps pinned in
  `backend/requirements.txt`) both just chain the scripts above — see
  [orchestration/README.md](orchestration/README.md) (incl. the monthly runbook) and [Pipeline: run order](#pipeline-run-order).
- Backend endpoints `GET /api/predictions/models`, `GET /api/predictions/forecast`
  (`backend/app/routers/predictions.py`) and `GET /api/llm/reports`, `GET /api/llm/reports/latest`
  (`backend/app/routers/llm.py`) only read the CSVs/JSON already written to `data/predictions/` and
  `data/llm_reports/` by the scripts above — they don't call MLflow, trigger training, or run LLM
  inference themselves. This is what the Predictions and Analyse LLM pages render.

## Deployment

`.github/workflows/deploy-backend.yml` runs on every push to `main` that touches `backend/`, `frontend/`,
`mlflow/`, `firebase.json`, `.firebaserc`, or itself. It builds and deploys, via Workload Identity
Federation (no JSON key):

1. the FastAPI API image (`backend/Dockerfile`) to the `tnera-joule` Cloud Run service,
2. the MLflow image (`mlflow/Dockerfile`) to the `tnera-joule-mlflow` Cloud Run service (pinned to 2Gi
   memory and 1 worker — Cloud Run's startup CPU boost otherwise spawns one worker per available CPU and
   OOMs regardless of the memory limit),
3. the built frontend SPA to Firebase Hosting, which rewrites `/api/**` to `tnera-joule` and `/mlflow/**`
   to `tnera-joule-mlflow` so both are served same-origin under the app's public hostname.

`.github/workflows/ci.yml` runs on PRs and pushes to `main`: backend `ruff check` + `pytest`, frontend
`npm run build`.

## Project structure

- `backend/`: FastAPI API (`app/`), Dockerfile, requirements
  - `app/models.py`, `app/schemas.py`: SQLAlchemy / Pydantic models (`DailyReading`, `FeatureEngineering`)
  - `app/db_copy.py`: one-shot `python -m app.db_copy`, copies a SQLite file into the `DATABASE_URL` database (SQLite → PostgreSQL cut-over)
  - `app/routers/`: `readings` (daily readings + feature-importance), `dashboard`, `database`,
    `predictions` (model backtests + production forecast, reads `data/predictions/`), `llm` (reads
    pre-generated reports from `data/llm_reports/`) endpoints
- `scripts/`: data pipeline — `enedis_*.py`, `ecoflow_*.py`, `tesla_*.py`, `aqara_download_app.py`,
  `water_download.py`/`eau_merge_csv.py`, `infoclimat_download.py`, `final_processing.py`,
  `transformation_processing.py`, `feature_engineering.py`, `import_csv.py` (CSV → database loader, SQLite or PostgreSQL),
  `dataset_creation.py` (builds the `dataset` table for training), `model_average.py` (naive seasonal
  average model), `analysis_llm.py` (local LLM backtest analysis) — see "Data pipeline" and "Predictions &
  MLflow" above
- `frontend/`: React/Vite/Tailwind SPA — `src/pages/`: `Dashboard.tsx`, `Consumption.tsx`, `EcoFlow.tsx`,
  `Enedis.tsx`, `Cost.tsx`, `Tesla.tsx`, `Climat.tsx`, `FeatureEngineering.tsx`, `Database.tsx`,
  `Predictions.tsx`, `LlmAnalysis.tsx` (`Graphics.tsx` is unused/unrouted)
- `mlflow/`: MLflow tracking server (`Dockerfile`) and offline
  training/prediction scripts (`train_xgboost.py`, `train_timesfm.py`, `train_chronos2.py`,
  `train_prophet.py`, `predict_prod.py`) — see "Predictions & MLflow" above
- `orchestration/`: `flow.py` (a Prefect flow, own venv per `orchestration/requirements.txt`) and a
  `Makefile`, both chaining the pipeline/training/predict-prod/analyze scripts — see
  [orchestration/README.md](orchestration/README.md)
- `models/`: local GGUF model file(s) for `scripts/analysis_llm.py` (gitignored; downloaded on first run)
- `data/raw/`: raw scraped/exported files (xlsx, per-year climat csv, mitmproxy captures)
- `data/processed/`: one merged CSV per source (`ENE_`/`ECO_`/`CLI_`/`TES_`/`AQR_`/`EAU_ByDay.csv`)
- `data/dataset/`: `Final-ByDay.csv` (outer-joined sources) and `Transformation-ByDay.csv` (cleaned,
  model-ready dataset used for ML training/predictions)
- `data/predictions/`: per-model backtest CSVs and production forecast CSVs written by `mlflow/*.py` /
  `scripts/model_average.py`, served by `GET /api/predictions/*`
- `data/llm_reports/`: JSON reports written by `scripts/analysis_llm.py`, served by `GET /api/llm/*`
  (gitignored)
- `docker-compose.yml`: local development environment (API + MLflow + frontend)
