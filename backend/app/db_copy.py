"""Copie un SQLite existant (ex. joule.db) vers la base de DATABASE_URL (PostgreSQL).

La cible est ÉCRASÉE (drop_all + create_all, puis copie table par table) ; la source
n'est jamais modifiée (rollback possible). Utilisé une seule fois pour la bascule
SQLite -> PostgreSQL :

    SOURCE_DATABASE_URL=sqlite:///data/joule.db \
    DATABASE_URL=postgresql+psycopg2://user:pass@localhost:5433/tnera-joule \
        python -m app.db_copy
"""

import logging
import os
import sys

from sqlalchemy import Integer, create_engine, insert, select, text

from app import models  # noqa: F401  (enregistre les tables dans Base.metadata)
from app.core.db import Base, engine as target

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

CHUNK = 500


def main() -> None:
    source_url = os.environ.get("SOURCE_DATABASE_URL")
    if not source_url:
        sys.exit("SOURCE_DATABASE_URL manquant")
    source = create_engine(source_url)

    logger.info("Réinitialisation de la cible %s", target.url.render_as_string(hide_password=True))
    Base.metadata.drop_all(bind=target)
    Base.metadata.create_all(bind=target)

    with source.connect() as src, target.begin() as dst:
        for table in Base.metadata.sorted_tables:  # parents avant enfants
            rows = [dict(r._mapping) for r in src.execute(select(table))]
            for i in range(0, len(rows), CHUNK):
                dst.execute(insert(table), rows[i : i + CHUNK])
            logger.info("  %s : %d lignes", table.name, len(rows))

            pk = list(table.primary_key.columns)
            if target.dialect.name == "postgresql" and len(pk) == 1 and isinstance(pk[0].type, Integer):
                dst.execute(text(  # ids copiés tels quels : réaligner la séquence
                    f"SELECT setval(pg_get_serial_sequence('{table.name}', '{pk[0].name}'), "
                    f"COALESCE((SELECT MAX({pk[0].name}) FROM {table.name}), 1), "
                    f"(SELECT MAX({pk[0].name}) FROM {table.name}) IS NOT NULL)"
                ))
    logger.info("Données copiées.")


if __name__ == "__main__":
    main()
