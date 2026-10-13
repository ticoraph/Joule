# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Electricity consumption platform (deployed on Cloud Run + Firebase Hosting): imports daily consumption/index/peak-power
readings, visualizes trends, and will eventually forecast consumption. Backend is FastAPI + SQLAlchemy 2.0
+ SQLite; frontend is React + Vite + TypeScript + Tailwind + React Query + Recharts. Auth is Firebase
Auth (Google Sign-In) with a server-side email allowlist.

This repo is public: it contains no personal data. The author's real dataset (`data/`), MLflow registry and
account-specific config (`private/`) stay out of git; `scripts/make_sample_data.py` generates a synthetic
dataset for anyone cloning it.

Infra (Cloud Run, Artifact Registry, IAM, GCS data bucket) is managed in a separate private Terraform repo
(GCP project `tnera-prod`, region `europe-west4`, resources named `tnera-joule*`). This repo owns app code plus
`firebase.json`/`.firebaserc` for Firebase Hosting, and its own deploy workflow
(`.github/workflows/deploy-backend.yml`, push to `main`; it first pulls `data/` from a private GCS bucket)
builds/pushes/deploys two Cloud Run services —
`tnera-joule` (the FastAPI API) and `tnera-joule-mlflow` (an MLflow tracking server, see below) — plus the
built frontend SPA to Firebase Hosting. `firebase.json` rewrites `/api/**` to `tnera-joule` and
`/mlflow/**` to `tnera-joule-mlflow`, both same-origin under the app's public hostname.

## Local development

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# add ALLOWED_EMAILS=["your.email@gmail.com"] to backend/.env
gcloud auth application-default login
gcloud auth application-default set-quota-project tnera-prod
# no real data? generate a synthetic dataset (data/joule.db + derived tables):
python scripts/make_sample_data.py
docker compose up -d
```

- Frontend: http://localhost:5177 (Vite, hot reload via mounted volume)
- API: http://localhost:8001 (`/health`, `/docs`); SQLite file at data/joule.db
- MLflow UI: http://localhost:5001 (tracking server; SQLite backend store `mlflow/mlflow.db` + artifact
  store `mlflow/artifacts/`, both gitignored and created on first run). Also deployed in production as its
  own Cloud Run service (`tnera-joule-mlflow`, `mlflow/Dockerfile`) with an *empty* registry (nothing is
  baked into the image; the allowed Host headers come from `MLFLOW_ALLOWED_HOSTS`, set at deploy time from the GitHub Actions repo variable of the same name — the Dockerfile default is `localhost`), reachable at `/mlflow` on the app's public hostname via the Firebase Hosting rewrite — pinned to
  `--workers 1` (Cloud Run's startup CPU boost otherwise spawns one worker per available CPU and OOMs)
  and an explicit `--allowed-hosts` list (MLflow 3.x's DNS-rebinding guard 403s any Host header not on
  it; must include the public hostname since Hosting forwards the original Host). Training scripts (`mlflow/train_xgboost.py`, `train_timesfm.py`, `train_chronos2.py`,
  `train_prophet.py`, `scripts/model_average.py`, `predict_prod.py`) are run manually/offline against this
  tracking server — not wired into any endpoint or CI job. They log runs/models to it and
  `predict_prod.py --model ... --version ...` promotes whichever version is passed to `Production` in the
  registry and writes a forecast CSV into `data/predictions/`, which `routers/predictions.py` (see below)
  reads. `orchestration/Makefile` (`make -C orchestration pipeline`/`train`/`predict-prod`/`analyze`) and
  `orchestration/flow.py` (a Prefect flow, own venv at `orchestration/requirements.txt` so `pip install
  prefect` can't upgrade shared deps pinned in `backend/requirements.txt`) both just chain these same
  scripts — see the README's "Pipeline: run order" section for the full step-by-step and command reference, and
  `orchestration/README.md` for the monthly runbook (which steps stay manual).
- LLM analysis (`scripts/analysis_llm.py`): loads a local Qwen3-4B GGUF model
  (`models/Qwen3-4B-Q4_K_M.gguf`, downloaded on first run via `llama-cpp-python`/`huggingface-hub`) and
  writes a French-language JSON report (`data/llm_reports/llm_report_<timestamp>.json`) analyzing the
  latest `data/predictions/*.csv` backtests. Run manually/offline (`make -C orchestration analyze` or standalone); not
  wired into any endpoint. `routers/llm.py` only serves the pre-generated JSON reports already on disk.
- API auth requires valid GCP ADC locally (used to verify Firebase ID tokens). Set `DISABLE_AUTH=true`
  in `backend/.env.local` to bypass auth in dev — falls back to the first entry in `ALLOWED_EMAILS`.
- After changing `ALLOWED_EMAILS`, restart the API container: `docker restart joule-api-1`

## Commands

Backend (from `backend/`, with deps installed in a venv):
```bash
pytest                  # run all tests
pytest app/tests/test_security.py::test_allowed_email_returns_email   # single test
ruff check .            # lint (ruff caches are in .ruff_cache)
```

Frontend (from `frontend/`):
```bash
npm run dev       # vite dev server
npm run build     # tsc -b && vite build
npm run preview
```

`.github/workflows/ci.yml` runs on PRs and pushes to `main`: backend job installs deps and runs
`ruff check app` + `pytest -q`; frontend job runs `npm ci` + `npm run build`. This is separate from
`deploy-backend.yml`, which only deploys on push to `main` (see Infra note above).

## Architecture

### Backend (`backend/app/`)
- `main.py`: creates the FastAPI app, runs `Base.metadata.create_all` on startup (no migration tool —
  SQLite schema changes are additive columns/tables applied via SQLAlchemy create_all), wires CORS from
  `settings.cors_list`, mounts `routers.readings`, `routers.dashboard`, `routers.database`,
  `routers.predictions`, and `routers.llm` under `/api`.
- `core/config.py`: `pydantic-settings` `Settings`, reads `.env` then `.env.local` (local overrides win).
  Key fields: `DATABASE_URL`, `CORS_ORIGINS`, `FIREBASE_PROJECT_ID`, `ALLOWED_EMAILS` (JSON array string),
  `DISABLE_AUTH`.
- `core/security.py`: `get_current_user_email` FastAPI dependency — verifies a Firebase ID token via
  `firebase_admin`, requires `email_verified` and membership in `settings.allowed_emails_list`
  (lowercased), otherwise 401/403. This dependency is attached at the router level (not per-endpoint).
- `core/db.py`: SQLite SQLAlchemy engine/session/`Base`, `get_db` dependency.
- `models.py`: two tables — `DailyReading` (one row per day, columns prefixed by source: `ene_*`
  consumption/index/peak-power, `eco_*` solar/battery, `cli_*` temperature/precipitation, `eau_*` water,
  `tes_*` Tesla charging, `aqr_*` Aqara room temps/smart-plug energy, `sun_*` sunrise/sunset) and
  `FeatureEngineering` (one row per day keyed on `date`, precomputed derived metrics — see
  `scripts/feature_engineering.py` below).
- `routers/readings.py`: `GET /readings/daily` — lists `DailyReading` rows (optional `start`/`end`
  filters), left-joined with `FeatureEngineering` columns. `GET /readings/feature-importance?target=...`
  — trains an on-the-fly `xgboost.XGBRegressor` over a fixed set of candidate columns (`CORR_KEYS`) to
  rank feature importance for a chosen target; used by the Feature Engineering page, not cached, retrains
  on every request.
- `routers/dashboard.py`: aggregates `DailyReading` in Python (not SQL) into totals, averages, max peak
  power, and a per-month consumption series — the data source for the Dashboard page's KPIs and chart.
- `routers/database.py`: `GET /database/dump` — introspects and dumps every SQLite table (last 365 days
  for tables with a `date` column) for the Database page; auth-gated like every other router.
- `routers/predictions.py`: `GET /predictions/models` — reads the latest CSV per model
  (`data/predictions/Joule_{Chronos2,TimesFM,XGBoost,Prophet,Average}_*.csv`, glob'd by filename pattern,
  newest by mtime), joins predictions against actual `FeatureEngineering.ene_conso_withouttesla` values,
  and computes MAE/RMSE/bias/MAPE — backtest comparison for the Predictions page. `GET /predictions/forecast`
  — same idea but for the latest `data/predictions/prediction_prod_*.csv` (a true future forecast with
  p10/p90 bands), produced offline by `mlflow/predict_prod.py`; the filename encodes which model produced
  it (`prediction_prod_{chronos2,timesfm,xgboost}_<start>_<end>.csv`), which the endpoint surfaces so the
  frontend can label the chart correctly. Both endpoints only read CSVs already present on disk; they
  don't trigger training or call MLflow themselves.
- `routers/llm.py`: `GET /llm/reports` / `GET /llm/reports/latest` — reads pre-generated JSON reports from
  `data/llm_reports/llm_report_*.json` (newest by filename, which is timestamp-sorted), no inference at
  request time. The reports themselves are produced offline by `scripts/analysis_llm.py` (see below).
- All endpoints are read-only today; data is written exclusively via `scripts/import_csv.py`,
  `scripts/feature_engineering.py`, and the offline `mlflow/*.py`/`scripts/*.py` training/prediction/
  analysis scripts (which write into `data/predictions/` and `data/llm_reports/`).

### Frontend (`frontend/src/`)
- `lib/firebase.ts` + `hooks/useAuth.tsx`: Firebase Auth context. `firebaseConfigured` lets the app run
  without Firebase env vars configured (e.g. for local dev without auth) — `App.tsx` skips the login gate
  when that's false.
- `api/client.ts`: thin fetch wrapper — attaches the current Firebase ID token as a Bearer header, prefixes
  requests with `${VITE_API_URL}/api`, and force-signs-out on 401/403 responses.
- `App.tsx`: route table gated by `useAuth()` — `/` (Dashboard), `/consumption`, `/ecoflow`, `/enedis`,
  `/cost`, `/predictions`, `/llm`, `/database`, `/tesla`, `/climat`, `/feature-engineering`.
- `pages/`: `Dashboard.tsx` (KPIs + monthly conso chart), `Consumption.tsx` (daily conso/PMax charts),
  `EcoFlow.tsx`/`Enedis.tsx`/`Tesla.tsx` (per-source detail dashboards), `Cost.tsx` (cost breakdown),
  `Climat.tsx` (daily + seasonal temperature/precipitation trends), `Database.tsx` (raw table dump viewer
  over `/database/dump`), `FeatureEngineering.tsx` (Pearson correlation matrix computed client-side over
  `CORR_KEYS`, plus a server-trained XGBoost feature-importance chart with a target-variable selector),
  `Predictions.tsx` (per-model backtest comparison — Chronos2/TimesFM/XGBoost/Prophet/Average
  predicted-vs-actual chart and error metrics — plus a production forecast chart with p10/p90 bands, over
  `/predictions/models` and `/predictions/forecast`), `LlmAnalysis.tsx` (renders the latest
  `/llm/reports/latest` report: per-model metric cards plus the LLM's French-language markdown-ish
  analysis text, with Qwen3's `<think>...</think>` blocks stripped client-side). `Graphics.tsx` exists but
  is not wired into `App.tsx`/`Sidebar.tsx` — currently unreachable/dead.
- Data fetching uses React Query against the `/api/dashboard`, `/api/readings/*`, `/api/database/*`,
  `/api/predictions/*`, and `/api/llm/*` endpoints.

### Data pipeline (`scripts/`)
Six data sources feed `data/processed/*-ByDay.csv`, each as a download → convert/merge pair that lands
raw exports in `data/raw/` and idempotently merges them into `data/processed/`:

- **Enedis** (consumption/index/peak-power): `enedis_download.py` (Playwright, logs into
  mon-compte-particulier.enedis.fr, saves a session via `--login`, downloads yearly .xlsx exports to
  `data/raw/`) → `enedis_xlsx_to_csv.py` (xlsx → csv) → `enedis_merge_csv.py` (merges into
  `data/processed/ENE_ByDay.csv`, columns prefixed `ENE_`, deduped by day).

- **Ecoflow** (solar/home/battery daily energy totals): `ecoflow_app_download.py` (EcoFlow's private app
  API — replays a captured session token against its pre-aggregated daily-totals endpoint, converting
  each Wh total to kWh rounded to 1 decimal) merges into `data/processed/ECO_ByDay.csv`, columns prefixed
  `ECO_` and suffixed `_kWh`. The token is captured the same way as Tesla's (see below): a mitmproxy
  capture saved to `data/mitmproxy/ecoflow_flows` (gitignored), which the script reads itself via
  mitmproxy's `FlowReader` to pull the bearer token/`groupId` out of the last matching request — no
  manual copy/paste, unlike `private/ecoflow_app.env`, which still works as a manual fallback. The
  official Open Platform API only exposes instantaneous device status (no daily-totals endpoint), which
  would require frequent polling (every 5-15 min) to integrate into daily totals — not practical, so that
  approach was dropped in favor of the app API above.

- **Aqara** (indoor/outdoor temperature, smart-plug energy): `aqara_download_app.py` — no auth/network
  needed; reads directly out of the Aqara Home macOS app's local SQLite cache
  (`~/Library/Containers/<GUID>/Data/Library/Database/chartData.sqlite`), one table per device.
  Temperature sensors are averaged into a daily value per (device, day); smart plugs report
  instantaneous watts, so their samples are trapezoidal-integrated over the day into a daily energy
  total (kWh), the same trapezoidal-integration approach EcoFlow's own app used to require before its
  daily-totals endpoint was found (see `ecoflow_app_download.py`). Merges
  into `data/processed/AQR_ByDay.csv`, one column per device (device ids in the gitignored `private/aqara_devices.json`, shape in
  `scripts/aqara_devices.example.json`), columns prefixed `AQR_` (smart-plug
  columns suffixed `_kWh`). Only covers date ranges that have actually been viewed in the app's own
  charts (it's a rolling cache, not full history). Measured days accumulate in
  `data/raw/AQR_ByDay_real.csv`; `AQR_ByDay.csv` is rebuilt from it on every run, with each smart
  plug's missing days in fully elapsed months filled from hand-typed monthly totals
  (`data/processed/AQR_ByDay_Monthly.csv`, read off the app's stats screen): `(total - measured) /
  missing days`, rounded down so a month never exceeds its total. `final_processing.py` only picks
  up `*_ByDay.csv`, so that monthly file isn't treated as a daily source.

- **Eau** (Grand Chambéry water meter): the portal only exposes the 5 most recent readings and has no
  export button, so `water_download.py` (Playwright, session via `--login`) scrapes the readings table's
  DataTables instance directly into `data/raw/`. Since the meter is only read ~once a year,
  `eau_merge_csv.py` spreads each interval's index-delta total across its days using a smoothed seasonal
  profile (summer-weighted) rather than reading true daily granularity, into `data/processed/EAU_ByDay.csv`,
  columns prefixed `EAU_`. Older yearly readings the portal no longer retains are backfilled from
  `private/water_manual_readings.json`; the portal URL (it embeds the subscription id) comes from the
  `WATER_PORTAL_URL` env var; the meter reference comes from `WATER_METER_REF`.

- **Climat** (Chambéry daily temperature/precipitation): `infoclimat_download.py` — no auth needed; one
  HTTP GET per year of infoclimat.fr's yearly "details" page (`/climatologie/annee/<year>/.../details/<station-id>.html`),
  parsing the daily series out of the embedded `Highcharts.Chart({...})` JSON (the same data that feeds
  the page's interactive chart tooltips) rather than scraping per-day pages, which infoclimat.fr serves
  degraded/empty for concurrent requests. Writes one `data/raw/infoclimat_<station-id>_<year>_byday.csv`
  per year, then merges all years into `data/processed/CLI_ByDay.csv`, columns prefixed `CLI_`.

- **Tesla** (vehicle charging energy/cost): no public Fleet API endpoint exposes charge history, so
  `tesla_parse_charge_history.py` instead replays a manual mitmproxy capture of the Tesla app's traffic
  (`docs/tesla_flows`, gitignored — recorded once with `mitmdump -w docs/tesla_flows` while proxying the
  app) and extracts every `/charge_history` response (`owner-api.teslamotors.com`) via mitmproxy's own
  `FlowReader`. Writes the full day+month detail to `data/raw/tesla_charge_history.csv`, and a
  day-granularity, kWh-converted `data/processed/TES_ByDay.csv`, columns prefixed `TES_`.

- **`scripts/final_processing.py`**: outer-joins every `data/processed/*-ByDay.csv` source on a normalized
  `YYYYMMDD` date key (each source has its own date format/granularity) into
  `data/dataset/Final-ByDay.csv`. Missing days/columns from a given source are left blank rather than
  dropping the row.

- **`scripts/transformation_processing.py`**: takes `data/dataset/Final-ByDay.csv` and cleans/derives
  features from it — drops unused EcoFlow columns, drops the now-redundant `_kWh` suffix from the
  remaining EcoFlow columns (every value in this dataset is in kWh), and derives daily HP/HC consumption
  and their share of `ENE_Conso` from the cumulative Enedis index columns — into
  `data/dataset/Transformation-ByDay.csv`, the flat, model-ready file intended for the future ML
  forecasting work behind the Predictions page and the one `import_csv.py` loads.
  
- **`scripts/import_csv.py`**: self-adapting, idempotent CSV → SQLite loader for
  `data/dataset/Transformation-ByDay.csv` — any CSV column without a matching `daily_readings` column
  gets added on the fly. Run locally pointed at `DATABASE_URL` (SQLite database file at `data/joule.db`); in production the
  database is pulled from the private GCS bucket and embedded in the Docker image by CI. This is the only write path into the database — there are no
  admin/write API endpoints.

- **`scripts/dataset_creation.py`**: drops and rebuilds a `dataset` table from `daily_readings` +
  `feature_engineering` (2022-01-01 onward), adding temporal/cyclical features (day-of-week, month,
  sin/cos encodings, weekend flag). This is the table the `mlflow/train_*.py` scripts and
  `scripts/model_average.py` train/backtest against — not the same table the API reads (`daily_readings`),
  so it needs a manual re-run before retraining after new data lands.

- **ML training/forecasting** (`mlflow/train_xgboost.py`, `train_timesfm.py` (zero-shot), `train_chronos2.py`
  (zero-shot), `train_prophet.py`, and `scripts/model_average.py` (naive day-of-year seasonal average, not
  MLflow-tracked)): each backtests against `dataset` and writes `data/predictions/Joule_{name}_*.csv`,
  read by `routers/predictions.py`'s `GET /predictions/models`. `mlflow/predict_prod.py --model ...
  --version ...` then promotes one chosen registered model version to `Production` and writes the true
  future forecast to `data/predictions/prediction_prod_{model}_*.csv`, read by `GET /predictions/forecast`.
  See the README's "Pipeline: run order" section for the full ordered command reference, `orchestration/Makefile`, and the Prefect flow.

## Auth model

Access is allowlist-based, not role-based: any Firebase-authenticated Google account whose verified email
is in `ALLOWED_EMAILS` gets full access to all endpoints. There is no per-user permission granularity.
Local env uses `backend/.env` (`ALLOWED_EMAILS`); production sets the Cloud Run service's env var directly
(console or `gcloud run services update ... --update-env-vars`).
