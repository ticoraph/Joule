from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import MetaData, Table, inspect, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user_email

router = APIRouter(
    prefix="/database", tags=["database"], dependencies=[Depends(get_current_user_email)]
)


@router.get("/dump")
def dump_database(db: Session = Depends(get_db)):
    """Contenu de chaque table (365 derniers jours si la table a une colonne `date`).

    Introspection SQLAlchemy : fonctionne sur SQLite (local) comme sur PostgreSQL (prod).
    """
    engine = db.get_bind()
    since = date.today() - timedelta(days=365)

    result = []
    for name in inspect(engine).get_table_names():
        table = Table(name, MetaData(), autoload_with=engine)
        columns = [c.name for c in table.columns]

        stmt = select(table)
        if "date" in table.c:
            stmt = stmt.where(table.c.date >= since).order_by(table.c.date.desc())

        rows = [dict(zip(columns, row)) for row in db.execute(stmt).all()]
        result.append({"name": name, "columns": columns, "rows": rows})

    return result
