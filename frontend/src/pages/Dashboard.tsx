import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import SourceChart from "../components/SourceChart";
import { DashboardData, DailyReading } from "../types";
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

function formatKwh(value: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value) + " kWh";
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      style={{
        background: "linear-gradient(145deg, rgba(30,41,59,0.5), rgba(15,23,42,0.5))",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 16,
        padding: "16px 20px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", zIndex: 2 }}>
        <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#f8fafc", marginBottom: 2 }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: dashboardData } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardData>("/dashboard"),
  });

  const { data: dailyData } = useQuery({
    queryKey: ["readings", "daily"],
    queryFn: () => api<DailyReading[]>("/readings/daily"),
  });

  let sumEte = 0, countEte = 0;
  let sumHiver = 0, countHiver = 0;
  let sumSolar12m = 0, countSolar12m = 0;
  let sumTesla12m = 0;
  let sumRain12m = 0;
  let sumWaterTotal = 0, countWaterTotal = 0;

  if (dailyData && dailyData.length > 0) {
    const sorted = [...dailyData].sort((a, b) => a.date.localeCompare(b.date));
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); 
    
    const endDate = new Date(currentYear, currentMonth, 0);
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
    
    const startDate = new Date(currentYear, currentMonth - 12, 1);
    const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-01`;

    sorted.forEach((d) => {
      const month = parseInt(d.date.substring(5, 7), 10);
      const isEte = month >= 4 && month <= 9;
      
      if (d.ene_conso != null) {
        if (isEte) { sumEte += d.ene_conso; countEte++; }
        else { sumHiver += d.ene_conso; countHiver++; }
      }

      if (d.date >= startDateStr && d.date <= endDateStr) {
        if (d.eco_solartotalgeneration != null) { sumSolar12m += d.eco_solartotalgeneration; countSolar12m++; }
        if (d.tes_homekwh != null) sumTesla12m += d.tes_homekwh;
        if (d.cli_precip != null) sumRain12m += d.cli_precip;
      }
      
      if (d.eau_conso != null) { sumWaterTotal += d.eau_conso; countWaterTotal++; }
    });
  }

  const avgConsoEte = countEte > 0 ? sumEte / countEte : 0;
  const avgConsoHiver = countHiver > 0 ? sumHiver / countHiver : 0;
  const avgSolar12m = countSolar12m > 0 ? sumSolar12m / countSolar12m : 0;
  const avgWaterTotal = countWaterTotal > 0 ? sumWaterTotal / countWaterTotal : 0;

  const eneChartData = toMonthlyChartData(
    trimToDataRange(toEneChartData(dailyData ?? []), ["ene_hp_kwh", "ene_hc_hors_tesla_kwh"]),
    ["ene_hp_kwh", "ene_hc_hors_tesla_kwh", "ene_hc_tesla_kwh", "ene_solar_kwh"],
  );
  const ecoChartData = toMonthlyChartData(
    trimToDataRange(dailyData ?? [], ["eco_solartohome", "eco_solartobattery", "eco_batterytotaldischarging"]),
    ["eco_solartohome", "eco_solartobattery", "eco_batterytotaldischarging"],
  );
  const cliChartData = toWeeklyChartData(
    trimToDataRange(dailyData ?? [], CLI_COLUMNS.map((c) => c.key)),
    CLI_COLUMNS.map((c) => c.key),
    { cli_tempmax: "avg", cli_tempmin: "avg", cli_tempmoy: "avg" },
  );
  const eauChartData = toMonthlyChartData(
    trimToDataRange(dailyData ?? [], EAU_COLUMNS.map((c) => c.key)),
    EAU_COLUMNS.map((c) => c.key),
  );
  const tesChartData = toMonthlyChartData(
    trimToDataRange(dailyData ?? [], ["tes_homekwh", "tes_superchargerkwh", "tes_otherkwh"]),
    ["tes_homekwh", "tes_superchargerkwh", "tes_otherkwh"],
  );
  const aqrTempChartData = toDailyChartData(
    trimToDataRange(dailyData ?? [], AQR_TEMP_CHART_KEYS),
    AQR_TEMP_CHART_KEYS,
  );
  // Monthly sums: the plugs' history before mid-2026 only comes from monthly totals spread evenly
  // over each month's days (see scripts/aqara_download_app.py), so daily points would be flat steps
  const aqrPriseChartData = withPriseTotal(
    toMonthlyChartData(trimToDataRange(dailyData ?? [], AQR_PRISE_CHART_KEYS), AQR_PRISE_CHART_KEYS),
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0c1f35 100%)",
        padding: "32px 24px",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "linear-gradient(135deg, #4f46e5, #3730a3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: "0 4px 20px rgba(79,70,229,0.45)",
              flexShrink: 0,
            }}
          >
            🏠
          </div>
          <div>
            <h1
              style={{
                fontSize: 30,
                fontWeight: 800,
                color: "#f1f5f9",
                margin: 0,
                lineHeight: 1.15,
                letterSpacing: "-0.02em",
              }}
            >
              Tableau de bord
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0, marginTop: 2 }}>
              Vue d'ensemble de la maison
            </p>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <StatCard
          label="Relevés"
          value={dashboardData?.total_readings ? String(dashboardData.total_readings) : "-"}
          sub={`${dashboardData?.first_date ?? "-"} → ${dashboardData?.last_date ?? "-"}`}
        />
        <StatCard
          label="Conso. Élec. Moy. Été"
          value={formatKwh(avgConsoEte)}
          sub="Avril - Septembre"
        />
        <StatCard
          label="Conso. Élec. Moy. Hiver"
          value={formatKwh(avgConsoHiver)}
          sub="Octobre - Mars"
        />
        <StatCard
          label="Prod. Solaire Moyenne"
          value={formatKwh(avgSolar12m)}
          sub="12 mois complets (quotidienne)"
        />
        <StatCard
          label="Conso. Tesla (Home)"
          value={formatKwh(sumTesla12m)}
          sub="12 mois complets (cumul)"
        />
        <StatCard
          label="Précipitations"
          value={`${sumRain12m.toFixed(1)} mm`}
          sub="12 mois complets (cumul)"
        />
        <StatCard
          label="Conso. Eau Moyenne"
          value={`${(avgWaterTotal * 1000).toFixed(0)} L`}
          sub="Depuis le début (quotidienne)"
        />
      </div>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <SourceChart title="ENE_ - Enedis (conso HP/HC)" data={eneChartData} series={ENE_SERIES} />
        <SourceChart title="ECO_ - EcoFlow (solaire, maison, batterie)" data={ecoChartData} series={ECO_SERIES} />
        <SourceChart title="CLI_ - Infoclimat (température, précipitations)" data={cliChartData} series={CLI_SERIES} />
        <SourceChart title="EAU_ - Eau (consommation)" data={eauChartData} series={EAU_SERIES} />
        <SourceChart title="TES_ - Tesla (recharge)" data={tesChartData} series={TES_SERIES} />
        <SourceChart title="AQR_ - Aqara (températures)" data={aqrTempChartData} series={AQR_TEMP_SERIES} />
        <SourceChart title="AQR_ - Aqara (prises)" data={aqrPriseChartData} series={AQR_PRISE_SERIES} />
      </div>
    </div>
  );
}
