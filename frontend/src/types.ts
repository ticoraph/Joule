export interface DailyReading {
  id: number;
  date: string;

  ene_conso: number | null;
  ene_index_total: number | null;
  ene_index_hp: number | null;
  ene_index_hc: number | null;
  ene_pmax: number | null;
  ene_pmax_hour: string | null;
  ene_hp_byday: number | null;
  ene_hc_byday: number | null;
  ene_hp_percent: number | null;
  ene_hc_percent: number | null;

  eco_solartotalgeneration: number | null;
  eco_solartobattery: number | null;
  eco_solartohome: number | null;
  eco_hometoloads: number | null;
  eco_batterytotaldischarging: number | null;
  eco_batterydiff: number | null;

  cli_tempmax: number | null;
  cli_tempmin: number | null;
  cli_tempmoy: number | null;
  cli_precip: number | null;

  eau_conso: number | null;

  tes_totalkwh: number | null;
  tes_homekwh: number | null;
  tes_superchargerkwh: number | null;
  tes_workkwh: number | null;
  tes_otherkwh: number | null;
  tes_totalcosteur: number | null;

  aqr_tempetage: number | null;
  aqr_tempfreezer: number | null;
  aqr_tempcongel: number | null;
  aqr_tempsalon: number | null;
  aqr_tempabrijardin: number | null;
  aqr_tempchaufferie: number | null;
  aqr_tempthermostat: number | null;
  aqr_priseordinateur_kwh: number | null;
  aqr_prisecafetiere_kwh: number | null;
  aqr_prisefrigo_kwh: number | null;
  aqr_prisesalon_kwh: number | null;
  aqr_prisealarme_kwh: number | null;
  aqr_prisemac_kwh: number | null;

  sun_sunrise_hour: string | null;
  sun_sunset_hour: string | null;
  sun_daylight_minute: number | null;

  eco_kwh_per_daylighthour: number | null;
  eco_actual_prod_minus_expected: number | null;
  eco_ratio_solarperconsototal: number | null;
  ene_hcwithoutesla_to_hp_ratio: number | null;
  ene_conso_withouttesla: number | null;
  cli_amplitude_tmax_min: number | null;
}

export interface MonthlyConsoStat {
  year: number;
  month: number;
  conso: number;
}

export interface ModelPredictionPoint {
  date: string;
  predicted: number | null;
  actual: number | null;
}

export interface ModelPredictionMetrics {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  mape: number | null;
}

export interface ModelPrediction {
  model: string;
  file: string;
  points: ModelPredictionPoint[];
  metrics: ModelPredictionMetrics | null;
}

export interface ForecastPoint {
  date: string;
  predicted: number | null;
  p10: number | null;
  p90: number | null;
  actual: number | null;
}

export interface ForecastMetrics {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  mape: number | null;
  pct_bias: number | null;
}

export interface Forecast {
  file: string | null;
  points: ForecastPoint[];
  metrics: ForecastMetrics | null;
}

export interface DashboardData {
  total_readings: number;
  first_date: string | null;
  last_date: string | null;
  total_conso: number;
  avg_daily_conso: number;
  max_pmax: number | null;
  max_pmax_hour: string | null;
  monthly_stats: MonthlyConsoStat[];
}
