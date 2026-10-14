from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

if settings.DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        settings.DATABASE_URL, pool_pre_ping=True, connect_args={"check_same_thread": False}
    )
else:
    # pg-shared (db-f1-micro) n'accepte que 75 connexions pour toutes les apps : pool réduit.
    engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_size=2, max_overflow=1)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
