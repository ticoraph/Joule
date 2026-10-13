FROM ghcr.io/mlflow/mlflow:v3.14.0

# mlflow's basic-auth app (--app-name basic-auth below) needs Flask-WTF for CSRF
# protection; not installed by the base image.
RUN pip install --no-cache-dir "Flask-WTF<2"

# The registry starts empty: runs/models are tracked locally (docker compose), not baked into the image.
RUN mkdir -p /mlflow/artifacts

ENV PORT=8080
# Host headers MLflow accepts (DNS-rebinding guard); Firebase Hosting forwards the public hostname.
ENV MLFLOW_ALLOWED_HOSTS=joule.tnera.fr
EXPOSE 8080

# Basic-auth credentials (MLFLOW_ADMIN_USERNAME/MLFLOW_ADMIN_PASSWORD, password >12 chars) and
# a static MLFLOW_FLASK_SERVER_SECRET_KEY (required by mlflow for CSRF signing, server refuses to
# start without it) are injected as Cloud Run env vars at deploy time, not baked into the image.
# The auth_config.ini is generated at container startup since mlflow only reads credentials from
# a file, not directly from env vars; the auth SQLite db is regenerated fresh from those env vars
# on every cold start (Cloud Run's filesystem is ephemeral per-instance anyway), so there's no
# persistence to manage for this single-admin-user setup.
CMD ["sh", "-c", "printf '[mlflow]\\ndefault_permission = READ\\ndatabase_uri = sqlite:////mlflow/basic_auth.db\\nadmin_username = %s\\nadmin_password = %s\\n' \"$MLFLOW_ADMIN_USERNAME\" \"$MLFLOW_ADMIN_PASSWORD\" > /mlflow/auth_config.ini && MLFLOW_AUTH_CONFIG_PATH=/mlflow/auth_config.ini mlflow server --app-name basic-auth --backend-store-uri sqlite:////mlflow/mlflow.db --default-artifact-root /mlflow/artifacts --static-prefix /mlflow --host 0.0.0.0 --port ${PORT} --workers 1 --allowed-hosts ${MLFLOW_ALLOWED_HOSTS}"]
