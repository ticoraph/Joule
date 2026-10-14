FROM ghcr.io/mlflow/mlflow:v3.14.0

# mlflow's basic-auth app (--app-name basic-auth below) needs Flask-WTF for CSRF
# protection; not installed by the base image. psycopg2-binary: PostgreSQL backend store (prod).
RUN pip install --no-cache-dir "Flask-WTF<2" psycopg2-binary

# The registry starts empty: runs/models are tracked locally (docker compose), not baked into the image.
RUN mkdir -p /mlflow/artifacts

ENV PORT=8080
# Host headers MLflow accepts (DNS-rebinding guard); Firebase Hosting forwards the public hostname.
# Local-only default: the real hostname is set as a Cloud Run env var at deploy time
# (GitHub Actions variable MLFLOW_ALLOWED_HOSTS), so it isn't committed to this public repo.
ENV MLFLOW_ALLOWED_HOSTS=localhost
EXPOSE 8080

# Basic-auth credentials (MLFLOW_ADMIN_USERNAME/MLFLOW_ADMIN_PASSWORD, password >12 chars) and
# a static MLFLOW_FLASK_SERVER_SECRET_KEY (required by mlflow for CSRF signing, server refuses to
# start without it) are injected as Cloud Run env vars at deploy time, not baked into the image.
# The auth_config.ini is generated at container startup since mlflow only reads credentials from
# a file, not directly from env vars.
#
# Databases (both default to local SQLite, as in docker compose):
#   MLFLOW_BACKEND_STORE_URI  runs / experiments / registry
#   MLFLOW_AUTH_DB_URI        basic-auth users
# In production both point to the same Cloud SQL PostgreSQL database (they use distinct alembic
# version tables, verified), e.g. postgresql+psycopg2://user:pass@/db?host=/cloudsql/<connection>.
# '%' is doubled when writing auth_config.ini (configparser interpolation) so URL-encoded passwords work.
# The admin user is (re)created from the env vars at every start, which is idempotent on PostgreSQL.
# Keep the SQLAlchemy pool small (MLFLOW_SQLALCHEMY_POOL_SIZE / MLFLOW_SQLALCHEMY_MAX_OVERFLOW):
# the shared instance only accepts 75 connections for all apps.
# Artifacts are still stored on the container's (ephemeral) disk.
CMD ["sh", "-c", "printf '[mlflow]\\ndefault_permission = READ\\ndatabase_uri = %s\\nadmin_username = %s\\nadmin_password = %s\\n' \"$(printf %s \"${MLFLOW_AUTH_DB_URI:-sqlite:////mlflow/basic_auth.db}\" | sed 's/%/%%/g')\" \"$MLFLOW_ADMIN_USERNAME\" \"$MLFLOW_ADMIN_PASSWORD\" > /mlflow/auth_config.ini && MLFLOW_AUTH_CONFIG_PATH=/mlflow/auth_config.ini mlflow server --app-name basic-auth --backend-store-uri \"${MLFLOW_BACKEND_STORE_URI:-sqlite:////mlflow/mlflow.db}\" --default-artifact-root /mlflow/artifacts --static-prefix /mlflow --host 0.0.0.0 --port ${PORT} --workers 1 --allowed-hosts ${MLFLOW_ALLOWED_HOSTS}"]
