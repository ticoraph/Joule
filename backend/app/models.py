from datetime import date

from sqlalchemy import Date, Float, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DailyReading(Base):
    __tablename__ = "daily_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True)

    # Enedis: consumption, meter index, peak power (kWh / kW)
    ene_conso: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_index_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_index_hp: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_index_hc: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_pmax: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_pmax_hour: Mapped[str | None] = mapped_column(Text, nullable=True)
    ene_hp_byday: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_hc_byday: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_hp_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_hc_percent: Mapped[float | None] = mapped_column(Float, nullable=True)

    # EcoFlow: daily solar/home/battery energy totals (kWh)
    eco_solartotalgeneration: Mapped[float | None] = mapped_column(Float, nullable=True)
    eco_solartobattery: Mapped[float | None] = mapped_column(Float, nullable=True)
    eco_solartohome: Mapped[float | None] = mapped_column(Float, nullable=True)
    eco_hometoloads: Mapped[float | None] = mapped_column(Float, nullable=True)
    eco_batterytotaldischarging: Mapped[float | None] = mapped_column(Float, nullable=True)
    eco_batterydiff: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Infoclimat: Chambery daily temperature/precipitation
    cli_tempmax: Mapped[float | None] = mapped_column(Float, nullable=True)
    cli_tempmin: Mapped[float | None] = mapped_column(Float, nullable=True)
    cli_tempmoy: Mapped[float | None] = mapped_column(Float, nullable=True)
    cli_precip: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Eau du Grand Chambery: daily water consumption (m3)
    eau_conso: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Tesla: daily vehicle charging energy (kWh) and cost (EUR)
    tes_totalkwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    tes_homekwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    tes_superchargerkwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    tes_workkwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    tes_otherkwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    tes_totalcosteur: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Aqara: room temperatures (°C) and smart-plug power (W)
    aqr_tempetage: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_tempfreezer: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_tempcongel: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_tempsalon: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_tempabrijardin: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_tempchaufferie: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_tempthermostat: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_priseordinateur_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_prisecafetiere_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_prisefrigo_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_prisesalon_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_prisealarme_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)
    aqr_prisemac_kwh: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Sun: astronomical daylight data
    sun_sunrise_hour: Mapped[str | None] = mapped_column(Text, nullable=True)
    sun_sunset_hour: Mapped[str | None] = mapped_column(Text, nullable=True)
    sun_daylight_minute: Mapped[int | None] = mapped_column(Integer, nullable=True)


class FeatureEngineering(Base):
    """Table to store precomputed data science / advanced metrics"""
    __tablename__ = "feature_engineering"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    eco_kwh_per_daylighthour: Mapped[float | None] = mapped_column(Float, nullable=True)
    eco_actual_prod_minus_expected: Mapped[float | None] = mapped_column(Float, nullable=True)
    eco_ratio_solarperconsototal: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_hcwithoutesla_to_hp_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_conso_withouttesla: Mapped[float | None] = mapped_column(Float, nullable=True)
    cli_amplitude_tmax_min: Mapped[float | None] = mapped_column(Float, nullable=True)


class Dataset(Base):
    """Table to store the combined dataset for XGBOOST modeling with temporal features."""
    __tablename__ = "dataset"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Remaining columns sorted alphabetically
    cli_amplitude_tmax_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    cli_precip: Mapped[float | None] = mapped_column(Float, nullable=True)
    cli_tempmoy: Mapped[float | None] = mapped_column(Float, nullable=True)
    date_cos_dayofweek: Mapped[float | None] = mapped_column(Float, nullable=True)
    date_cos_month: Mapped[float | None] = mapped_column(Float, nullable=True)
    date_dayofmonth: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_dayofweek: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_dayofyear: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_is_weekend: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Using Integer (0/1) for XGBOOST
    date_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_quarter: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_sin_dayofweek: Mapped[float | None] = mapped_column(Float, nullable=True)
    date_sin_month: Mapped[float | None] = mapped_column(Float, nullable=True)
    date_weekofyear: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eco_kwh_per_daylighthour: Mapped[float | None] = mapped_column(Float, nullable=True)
    eco_actual_prod_minus_expected: Mapped[float | None] = mapped_column(Float, nullable=True)
    eco_ratio_solarperconsototal: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_conso: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_conso_withouttesla: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_hc_byday: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_hp_byday: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_pmax: Mapped[float | None] = mapped_column(Float, nullable=True)
    ene_hcwithoutesla_to_hp_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    sun_daylight_minute: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tes_homekwh: Mapped[float | None] = mapped_column(Float, nullable=True)
