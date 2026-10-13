import json

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", ".env.local"), extra="ignore")

    DATABASE_URL: str = "sqlite:///data/joule.db"
    CORS_ORIGINS: str = "http://localhost:5177"
    FIREBASE_PROJECT_ID: str = "tnera-prod"
    ALLOWED_EMAILS: str = "[]"
    # Surcharge locale (.env.local) : désactive la vérification du token Firebase en dev.
    DISABLE_AUTH: bool = False

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_emails_list(self) -> list[str]:
        return [e.lower() for e in json.loads(self.ALLOWED_EMAILS)]


settings = Settings()
