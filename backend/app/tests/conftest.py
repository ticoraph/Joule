"""Tests sur un SQLite temporaire par défaut ; sur PostgreSQL si DATABASE_URL est défini (CI)."""

import os
import tempfile

# Avant l'import de app.* (Settings lit l'env).
os.environ["DATABASE_URL"] = os.environ.get("DATABASE_URL") or f"sqlite:///{tempfile.mkdtemp(prefix='joule-test-')}/test.db"

import pytest  # noqa: E402

from app import models  # noqa: E402, F401
from app.core.db import Base, SessionLocal, engine  # noqa: E402


@pytest.fixture()
def session():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as s:
        yield s
