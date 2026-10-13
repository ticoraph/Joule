# Orchestration

Two equivalent ways to chain the data-pipeline / training / forecasting scripts
(steps 3–8 of [Pipeline: run order](../README.md#pipeline-run-order)):

- `flow.py` — a [Prefect](https://www.prefect.io/) flow, one `@task` per script.
- `Makefile` — the same chain as plain `make` targets.

Both only *call* the existing scripts (`scripts/*.py`, `mlflow/*.py`) from the repo root with the
main `.venv`; neither contains any pipeline logic of its own. Steps 1–2 (downloading/merging raw data
per source) are **not** automated, because several sources need a login or a fresh mitmproxy capture
— see the [monthly runbook](#monthly-runbook-1st-of-the-month) below, which starts with
`scripts/mitm_capture.sh`.

## One-time setup

All commands are run from the repo root.

```bash
# Main venv - where pandas/xgboost/mlflow/etc. live (used by every script)
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt

# Separate venv for Prefect only
python3 -m venv orchestration/.venv
orchestration/.venv/bin/pip install -r orchestration/requirements.txt
```

Prefect has its own venv on purpose: `pip install prefect` into the main `.venv` once silently
upgraded fastapi/starlette/pydantic-settings past the versions pinned in `backend/requirements.txt`.
The Prefect venv only runs `flow.py`; each task then shells out to `.venv/bin/python`.

Sessions for the sources that need one (only redo these when they expire):

```bash
.venv/bin/python scripts/enedis_download.py --login   # Enedis: interactive login, saves a Playwright session
.venv/bin/python scripts/water_download.py --login    # Water: same idea (only needed ~once a year)
```

## Running the Prefect flow

No Prefect server is needed: each run starts a short-lived, in-memory local Prefect API (Prefect 3's
default when `PREFECT_API_URL` isn't set) and tears it down at the end. Nothing persists between runs.

```bash
# Steps 3-5 (data only): final_processing -> transformation -> import_csv
#            -> feature_engineering -> dataset_creation
orchestration/.venv/bin/python orchestration/flow.py

# Step 6: train/backtest all 5 models (in parallel) against the `dataset` table
orchestration/.venv/bin/python orchestration/flow.py --train

# Step 7: promote a registered model version to Production + write the future forecast
orchestration/.venv/bin/python orchestration/flow.py --predict-prod \
    --model Joule_Chronos2_Energy_Prediction --version 9

# Step 8: LLM analysis of the backtest CSVs (local Qwen3-4B GGUF, heavy)
orchestration/.venv/bin/python orchestration/flow.py --analyze
```

`--train`, `--predict-prod` and `--analyze` are mutually exclusive, and none of them runs steps 3–5 —
run the flow without arguments first when new data has landed. If a task fails
(non-zero exit code from the underlying script), the flow stops and Prefect prints the failing task.

The training step (6) needs the MLflow tracking server reachable at `http://localhost:5001`:

```bash
docker compose up -d mlflow
```

## Running with make

Same steps, no Prefect needed. Either from the repo root with `-C`, or from inside `orchestration/`:

```bash
make -C orchestration pipeline       # steps 3-5 (same as flow.py with no flag)
make -C orchestration train          # step 6 (same as flow.py --train, but trains sequentially)
make -C orchestration predict-prod MODEL=Joule_Chronos2_Energy_Prediction VERSION=9   # step 7
make -C orchestration analyze        # step 8

# Individual steps
make -C orchestration process        # 3a  final_processing.py
make -C orchestration transform      # 3b  transformation_processing.py
make -C orchestration import         # 4a  import_csv.py
make -C orchestration features       # 4b  feature_engineering.py
make -C orchestration dataset        # 5   dataset_creation.py
make -C orchestration train          # 6   all 5 models
make -C orchestration train-xgboost  # 6   one model (also train-timesfm / train-chronos2 / train-average / train-prophet)
```

## Monthly runbook (1st of the month)

The goal is to append the previous month's data, retrain/backtest, refresh the production forecast and
ship it. Items marked **manual** can't be scripted today.

### 0. Capture the EcoFlow and Tesla app traffic first (manual, iPhone)

Do this **before anything else**: the EcoFlow token expires ~30 days after login, so a monthly run
always needs a fresh one, and Tesla's charge history only comes from a capture.

```bash
scripts/mitm_capture.sh            # both captures, one after the other
scripts/mitm_capture.sh ecoflow    # or just one of them
scripts/mitm_capture.sh tesla
```

The script prints the Mac's LAN IP and the step-by-step setup for the iPhone (Wi-Fi proxy on port 8080,
mitmproxy certificate from <http://mitm.it> — only needed once), then runs `mitmdump` writing to
`data/mitmproxy/ecoflow_flows` / `data/mitmproxy/tesla_flows`:

- **EcoFlow**: open the PowerStream daily-stats screen and pull to refresh.
- **Tesla**: open the vehicle's charge history and browse a few months/days.

Wait until `POST .../iot-service/index/common/query` (EcoFlow) or `/charge_history` (Tesla) requests
scroll by in the terminal **before** pressing Ctrl+C. If the script warns that the file is empty or
missing, nothing was captured — redo it. Otherwise `ecoflow_app_download.py` silently falls back to the
old token in `private/ecoflow_app.env` and fails with `401 Unauthorized`.

Turn the iPhone's Wi-Fi proxy back **off** afterwards.

### 1. Refresh raw data (manual)

Replace `YYYY-MM` below with the month that just ended.

| Source | What to do | Command |
|---|---|---|
| Enedis | **Manual** if the session expired: rerun `--login` first. On **January 1st**, pass `--year <last year>` — the default is the current year, which has no data yet. | `.venv/bin/python scripts/enedis_download.py` then `scripts/enedis_xlsx_to_csv.py` and `scripts/enedis_merge_csv.py` |
| EcoFlow | Needs step 0's fresh capture. With no arguments the script fetches the whole previous calendar month (`--date` / `--start --end` still work for a single day or a custom range). | `.venv/bin/python scripts/ecoflow_app_download.py` |
| Tesla | Needs step 0's fresh capture. | `.venv/bin/python scripts/tesla_parse_charge_history.py` |
| Aqara | **Manual**: open the Aqara Home app on the Mac and browse the last month in each device's charts (the script reads the app's local cache, which only contains ranges you've viewed). Then add last month's total for each plug (from the app's stats screen) as a new row in `data/processed/AQR_ByDay_Monthly.csv` — the script spreads `total − measured days` evenly over the plug's missing days, never exceeding the total. | `.venv/bin/python scripts/aqara_download_app.py` |
| Climat | Nothing manual. With no arguments the script re-downloads the current year (plus last year in January, to get December) and re-merges every year already in `data/raw/`. | `.venv/bin/python scripts/infoclimat_download.py` |
| Water | Only when a new meter reading exists (~once a year). | `.venv/bin/python scripts/water_download.py` then `scripts/eau_merge_csv.py` |

Quick sanity check before going further: the last rows of each `data/processed/*_ByDay.csv` should
reach the end of last month.

### 2. Rebuild the dataset (automated), then retrain if wanted

```bash
orchestration/.venv/bin/python orchestration/flow.py           # or: make -C orchestration pipeline

# optional - retrain/backtest every model on the new data
docker compose up -d mlflow
orchestration/.venv/bin/python orchestration/flow.py --train   # or: make -C orchestration train
```

### 3. Pick the production model (manual)

Compare the new backtests — MLflow UI at http://localhost:5001, or the Predictions page of the local
app (http://localhost:5177/predictions) — and note the registered model name + version you trust, then:

```bash
orchestration/.venv/bin/python orchestration/flow.py --predict-prod --model <name> --version <n>
```

Caveat: `mlflow/predict_prod.py` is written around Chronos2's pyfunc signature; other models may not
produce a correct forecast without changes to the script (see [Pipeline: run order](../README.md#pipeline-run-order),
step 7).

### 4. LLM report (optional)

```bash
orchestration/.venv/bin/python orchestration/flow.py --analyze
```

### 5. Ship it

Production reads the CSVs/JSON committed in `data/` and the MLflow registry committed in `mlflow/`.
Committing and pushing to `main` triggers `.github/workflows/deploy-backend.yml` (it watches `data/**`
and `mlflow/**`):

```bash
git add data/ mlflow/
git commit -m "data <YYYY-MM>"
git push
```

Then check the deployed app once the deploy finishes.
