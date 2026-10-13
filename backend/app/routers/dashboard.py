from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user_email
from app.models import DailyReading
from app.schemas import DashboardOut, MonthlyConsoStat

router = APIRouter(
    prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user_email)]
)


@router.get("", response_model=DashboardOut)
def get_dashboard(db: Session = Depends(get_db)):
    readings = db.execute(select(DailyReading).order_by(DailyReading.date)).scalars().all()

    total_conso = sum(r.ene_conso or 0.0 for r in readings)
    conso_readings = [r for r in readings if r.ene_conso is not None]
    avg_daily_conso = total_conso / len(conso_readings) if conso_readings else 0.0

    pmax_readings = [r for r in readings if r.ene_pmax is not None]
    max_pmax_reading = max(pmax_readings, key=lambda r: r.ene_pmax, default=None)

    monthly_totals: dict[tuple[int, int], float] = defaultdict(float)
    for r in readings:
        if r.ene_conso is not None:
            monthly_totals[(r.date.year, r.date.month)] += r.ene_conso

    monthly_stats = [
        MonthlyConsoStat(year=year, month=month, conso=conso)
        for (year, month), conso in sorted(monthly_totals.items())
    ]

    return DashboardOut(
        total_readings=len(readings),
        first_date=readings[0].date if readings else None,
        last_date=readings[-1].date if readings else None,
        total_conso=total_conso,
        avg_daily_conso=avg_daily_conso,
        max_pmax=max_pmax_reading.ene_pmax if max_pmax_reading else None,
        max_pmax_hour=max_pmax_reading.ene_pmax_hour if max_pmax_reading else None,
        monthly_stats=monthly_stats,
    )
