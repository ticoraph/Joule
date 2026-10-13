import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import SourceChart from "../components/SourceChart";
import {
  AQR_PRISE_CHART_KEYS,
  AQR_PRISE_SERIES,
  AQR_TEMP_CHART_KEYS,
  AQR_TEMP_SERIES,
  withPriseTotal,
  CLI_COLUMNS,
  CLI_SERIES,
  EAU_COLUMNS,
  EAU_SERIES,
  ECO_SERIES,
  ENE_SERIES,
  TES_SERIES,
  toDailyChartData,
  toEneChartData,
  toMonthlyChartData,
  toWeeklyChartData,
  trimToDataRange,
} from "../lib/readings";
import { DailyReading } from "../types";

export default function Graphics() {
  const { data } = useQuery({
    queryKey: ["readings", "daily"],
    queryFn: () => api<DailyReading[]>("/readings/daily"),
  });

  const eneChartData = toMonthlyChartData(
    trimToDataRange(toEneChartData(data ?? []), ["ene_hp_kwh", "ene_hc_hors_tesla_kwh"]),
    ["ene_hp_kwh", "ene_hc_hors_tesla_kwh", "ene_hc_tesla_kwh", "ene_solar_kwh"],
  );
  const ecoChartData = toMonthlyChartData(
    trimToDataRange(data ?? [], ["eco_solartohome", "eco_solartobattery", "eco_batterytotaldischarging"]),
    ["eco_solartohome", "eco_solartobattery", "eco_batterytotaldischarging"],
  );
  const cliChartData = toWeeklyChartData(
    trimToDataRange(data ?? [], CLI_COLUMNS.map((c) => c.key)),
    CLI_COLUMNS.map((c) => c.key),
    { cli_tempmax: "avg", cli_tempmin: "avg", cli_tempmoy: "avg" },
  );
  const eauChartData = toMonthlyChartData(
    trimToDataRange(data ?? [], EAU_COLUMNS.map((c) => c.key)),
    EAU_COLUMNS.map((c) => c.key),
  );
  const tesChartData = toMonthlyChartData(
    trimToDataRange(data ?? [], ["tes_homekwh", "tes_superchargerkwh", "tes_otherkwh"]),
    ["tes_homekwh", "tes_superchargerkwh", "tes_otherkwh"],
  );
  const aqrTempChartData = toDailyChartData(
    trimToDataRange(data ?? [], AQR_TEMP_CHART_KEYS),
    AQR_TEMP_CHART_KEYS,
  );
  const aqrPriseChartData = withPriseTotal(
    toDailyChartData(trimToDataRange(data ?? [], AQR_PRISE_CHART_KEYS), AQR_PRISE_CHART_KEYS),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Graphiques</h1>

      <SourceChart title="ENE_ - Enedis (conso HP/HC)" data={eneChartData} series={ENE_SERIES} />
      <SourceChart title="ECO_ - EcoFlow (solaire, maison, batterie)" data={ecoChartData} series={ECO_SERIES} />
      <SourceChart title="CLI_ - Infoclimat (température, précipitations)" data={cliChartData} series={CLI_SERIES} />
      <SourceChart title="EAU_ - Eau (consommation)" data={eauChartData} series={EAU_SERIES} />
      <SourceChart title="TES_ - Tesla (recharge)" data={tesChartData} series={TES_SERIES} />
      <SourceChart title="AQR_ - Aqara (températures)" data={aqrTempChartData} series={AQR_TEMP_SERIES} />
      <SourceChart title="AQR_ - Aqara (prises)" data={aqrPriseChartData} series={AQR_PRISE_SERIES} />
    </div>
  );
}
