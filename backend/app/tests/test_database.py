from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.core.security import get_current_user_email
from app.main import app
from app.models import DailyReading


def test_dump_filtre_365_jours(session):
    today = date.today()
    session.add_all([
        DailyReading(date=today, ene_conso=1.5),
        DailyReading(date=today - timedelta(days=400), ene_conso=9.9),
    ])
    session.commit()

    app.dependency_overrides[get_current_user_email] = lambda: "test@example.com"
    try:
        with TestClient(app) as client:
            response = client.get("/api/database/dump")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    tables = {t["name"]: t for t in response.json()}
    assert {"daily_readings", "feature_engineering", "dataset"} <= tables.keys()
    readings = tables["daily_readings"]
    assert "ene_conso" in readings["columns"]
    assert [r["ene_conso"] for r in readings["rows"]] == [1.5]  # la ligne de -400 j est exclue
    assert readings["rows"][0]["date"] == today.isoformat()
