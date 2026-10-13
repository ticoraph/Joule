from datetime import date

from pydantic import BaseModel, ConfigDict


class DailyReadingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date

    ene_conso: float | None
    ene_index_total: float | None
    ene_index_hp: float | None
    ene_index_hc: float | None
    ene_pmax: float | None
    ene_pmax_hour: str | None
    ene_hp_byday: float | None
    ene_hc_byday: float | None
    ene_hp_percent: float | None
    ene_hc_percent: float | None

    eco_solartotalgeneration: float | None
    eco_solartobattery: float | None
    eco_solartohome: float | None
    eco_hometoloads: float | None
    eco_batterytotaldischarging: float | None
    eco_batterydiff: float | None

    cli_tempmax: float | None
    cli_tempmin: float | None
    cli_tempmoy: float | None
    cli_precip: float | None

    eau_conso: float | None

    tes_totalkwh: float | None
    tes_homekwh: float | None
    tes_superchargerkwh: float | None
    tes_workkwh: float | None
    tes_otherkwh: float | None
    tes_totalcosteur: float | None

    aqr_tempetage: float | None
    aqr_tempfreezer: float | None
    aqr_tempcongel: float | None
    aqr_tempsalon: float | None
    aqr_tempabrijardin: float | None
    aqr_tempchaufferie: float | None
    aqr_tempthermostat: float | None
    aqr_priseordinateur_kwh: float | None
    aqr_prisecafetiere_kwh: float | None
    aqr_prisefrigo_kwh: float | None
    aqr_prisesalon_kwh: float | None
    aqr_prisealarme_kwh: float | None
    aqr_prisemac_kwh: float | None

    sun_sunrise_hour: str | None
    sun_sunset_hour: str | None
    sun_daylight_minute: int | None

    eco_kwh_per_daylighthour: float | None = None
    eco_actual_prod_minus_expected: float | None = None
    eco_ratio_solarperconsototal: float | None = None
    ene_hcwithoutesla_to_hp_ratio: float | None = None
    ene_conso_withouttesla: float | None = None
    cli_amplitude_tmax_min: float | None = None


class MonthlyConsoStat(BaseModel):
    year: int
    month: int
    conso: float


class DashboardOut(BaseModel):
    total_readings: int
    first_date: date | None
    last_date: date | None
    total_conso: float
    avg_daily_conso: float
    max_pmax: float | None
    max_pmax_hour: str | None
    monthly_stats: list[MonthlyConsoStat]
