import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  ComposedChart,
  ScatterChart,
  CartesianGrid,
  Legend,
  Scatter,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { DailyReading } from "../types";

const PRICE_HC = 0.1251; // ENE_Price_kWh_HC_Euro

export default function Tesla() {
  const { data, isLoading } = useQuery({
    queryKey: ["readings", "daily"],
    queryFn: () => api<DailyReading[]>("/readings/daily"),
  });

  if (isLoading) {
    return <div className="p-8">Chargement des données Tesla...</div>;
  }

  // Ensure chronological order
  const sortedData = [...(data || [])].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const last365Data = sortedData
    .filter((r) => r.tes_homekwh != null || r.ene_pmax != null)
    .slice(-365);

  const totalTeslaKwh = last365Data.reduce((s, r) => s + (r.tes_homekwh ?? 0), 0);
  const teslaCost = totalTeslaKwh * PRICE_HC;

  const chartData = last365Data.map((r) => ({
    date: r.date,
    tesHomeKwh: r.tes_homekwh,
    enePMax: r.ene_pmax,
  })).filter((r) => r.tesHomeKwh != null && r.enePMax != null);

  let daysWithTesla = 0;
  let daysWithoutTesla = 0;
  let sumPmaxWithTesla = 0;
  let sumPmaxWithoutTesla = 0;

  chartData.forEach((r) => {
    // @ts-ignore
    if (r.tesHomeKwh > 0.5) {
      daysWithTesla++;
      // @ts-ignore
      sumPmaxWithTesla += r.enePMax;
    } else {
      daysWithoutTesla++;
      // @ts-ignore
      sumPmaxWithoutTesla += r.enePMax;
    }
  });

  const avgPmaxWith = daysWithTesla > 0 ? (sumPmaxWithTesla / daysWithTesla).toFixed(1) : "0";
  const avgPmaxWithout = daysWithoutTesla > 0 ? (sumPmaxWithoutTesla / daysWithoutTesla).toFixed(1) : "0";
  const pmaxIncrease = daysWithoutTesla > 0 && sumPmaxWithoutTesla > 0 
    ? Math.round(((sumPmaxWithTesla / daysWithTesla) / (sumPmaxWithoutTesla / daysWithoutTesla) - 1) * 100) 
    : 0;

  // Correlation Linear Regression: y = m*x + b
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  const n = chartData.length;
  chartData.forEach(d => {
    const x = d.tesHomeKwh ?? 0;
    const y = d.enePMax ?? 0;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  });
  const m = n > 0 && (n * sumX2 - sumX * sumX) !== 0 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0;
  const b = n > 0 ? (sumY - m * sumX) / n : 0;

  const minX = n > 0 ? Math.min(...chartData.map(d => d.tesHomeKwh ?? 0)) : 0;
  const maxX = n > 0 ? Math.max(...chartData.map(d => d.tesHomeKwh ?? 0)) : 0;
  const correlationSegment = [
    { x: minX, y: m * minX + b },
    { x: maxX, y: m * maxX + b }
  ];

  const pmaxHourCounts = Array(24).fill(0);
  last365Data.forEach((r) => {
    if (r.ene_pmax != null && r.ene_pmax_hour != null) {
      const hourStr = r.ene_pmax_hour.split(":")[0];
      const hour = parseInt(hourStr, 10);
      if (!isNaN(hour) && hour >= 0 && hour < 24) {
        pmaxHourCounts[hour]++;
      }
    }
  });

  const hourChartData = pmaxHourCounts.map((count, hour) => ({
    hour: `${hour}h`,
    count,
  }));


  const monthKeys: string[] = [];
  last365Data.forEach((r) => {
    if (r.date != null) {
      const ym = r.date.substring(0, 7); // "YYYY-MM"
      if (!monthKeys.includes(ym)) {
        monthKeys.push(ym);
      }
    }
  });

  const heatmapData = monthKeys.map(() => Array(17).fill(0));
  last365Data.forEach((r) => {
    if (r.ene_pmax != null && r.date != null) {
      const ym = r.date.substring(0, 7);
      const mIndex = monthKeys.indexOf(ym);
      let bucket = Math.floor(r.ene_pmax);
      if (bucket < 0) bucket = 0;
      if (bucket > 16) bucket = 16;
      if (mIndex >= 0) {
        heatmapData[mIndex][bucket]++;
      }
    }
  });

  const MONTHS_LABELS = monthKeys.map((ym) => {
    const [y, m] = ym.split("-");
    const d = new Date(parseInt(y), parseInt(m) - 1, 1);
    const label = d.toLocaleDateString("fr-FR", { month: "short" });
    return label.charAt(0).toUpperCase() + label.slice(1) + " " + y.slice(2);
  });
  
  const maxHeatmapCount = Math.max(1, ...heatmapData.flat());

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0c1f35 100%)",
        padding: "32px 24px",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "linear-gradient(135deg, #10b981, #059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: "0 4px 20px rgba(16,185,129,0.45)",
              flexShrink: 0,
            }}
          >
            🚗
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#f8fafc", margin: 0 }}>
            Analyse Tesla
          </h1>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: 20 }}>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>PMax moyen (Sans charge)</div>
            <div style={{ color: "#f8fafc", fontSize: 28, fontWeight: 700 }}>{avgPmaxWithout} <span style={{ fontSize: 16, color: "#64748b" }}>kVA</span></div>
          </div>
          <div style={{ flex: "1 1 200px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: 20 }}>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>PMax moyen (Avec charge)</div>
            <div style={{ color: "#f59e0b", fontSize: 28, fontWeight: 700 }}>{avgPmaxWith} <span style={{ fontSize: 16, color: "#64748b" }}>kVA</span></div>
          </div>
          <div style={{ flex: "1 1 200px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: 20 }}>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>Impact Recharge (kVA)</div>
            <div style={{ color: "#ef4444", fontSize: 28, fontWeight: 700 }}>+{pmaxIncrease}%</div>
          </div>
          <div style={{ flex: "1 1 200px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: 20 }}>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>Coût (365 derniers jours)</div>
            <div style={{ color: "#10b981", fontSize: 28, fontWeight: 700 }}>
              {new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(teslaCost)} <span style={{ fontSize: 16, color: "#64748b" }}>€</span>
            </div>
          </div>
          <div style={{ flex: "1 1 200px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: 20 }}>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>Conso (365 derniers jours)</div>
            <div style={{ color: "#3b82f6", fontSize: 28, fontWeight: 700 }}>
              {new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(totalTeslaKwh)} <span style={{ fontSize: 16, color: "#64748b" }}>kWh</span>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 20,
          padding: "28px 28px 20px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 48px rgba(0,0,0,0.35)",
          marginBottom: 24,
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Corrélation : Énergie Tesla (kWh) vs Pic Enedis (kVA)
          </h2>
        </div>
        
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                type="number"
                dataKey="tesHomeKwh"
                name="Énergie Tesla"
                unit=" kWh"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
              />
              <YAxis
                type="number"
                dataKey="enePMax"
                name="Pic Enedis"
                unit=" kVA"
                tick={{ fill: "#f59e0b", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={{ borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(15,23,42,0.9)", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                labelStyle={{ display: 'none' }}
                itemStyle={{ color: "#e2e8f0" }}
                formatter={(value: number, name: string) => [value.toFixed(1), name]}
              />
              <Scatter
                name="Jours"
                data={chartData}
                fill="#3b82f6"
                fillOpacity={0.6}
              />
              <ReferenceLine 
                segment={correlationSegment} 
                stroke="#ef4444" 
                strokeWidth={2} 
                strokeDasharray="4 4" 
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 20,
          padding: "28px 28px 20px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 48px rgba(0,0,0,0.35)",
          marginBottom: 24,
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Répartition des pics de puissance (ENE_PMax_Hour) sur 24h
          </h2>
        </div>
        
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={hourChartData}
              margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey="hour"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
              />
              <YAxis
                tick={{ fill: "#f59e0b", fontSize: 12 }}
                label={{ value: "Fréquence (jours)", angle: -90, position: "insideLeft", fill: "#f59e0b" }}
                stroke="rgba(255,255,255,0.2)"
              />
              <Tooltip
                contentStyle={{ borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(15,23,42,0.9)", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                labelStyle={{ fontWeight: "bold", color: "#f8fafc" }}
                itemStyle={{ color: "#e2e8f0" }}
                formatter={(value: number) => [value, "Jours avec PMax"]}
              />
              
              <Bar
                dataKey="count"
                name="Occurrences"
                fill="#f59e0b"
                radius={[4, 4, 0, 0]}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>



      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 20,
          padding: "28px 28px 20px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 48px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Heatmap Mensuelle : Tranches de Puissance (kVA)
          </h2>
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", overflowX: "auto" }}>
          {Array(17).fill(0).map((_, i) => 16 - i).map((bucket) => (
            <div key={bucket} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 60, fontSize: 12, color: "#94a3b8", textAlign: "right", paddingRight: 8 }}>
                {bucket}-{bucket + 1}
              </div>
              {MONTHS_LABELS.map((monthLabel, monthIdx) => {
                const count = heatmapData[monthIdx][bucket];
                const intensity = count / maxHeatmapCount;
                
                let baseColor = "59, 130, 246"; // blue (6 to 8 kVA)
                if (bucket >= 12) {
                  baseColor = "239, 68, 68"; // red
                } else if (bucket >= 9) {
                  baseColor = "245, 158, 11"; // orange
                } else if (bucket < 6) {
                  baseColor = "16, 185, 129"; // green
                }

                return (
                  <div 
                    key={monthIdx}
                    title={`${monthLabel} : ${count} jours dans [${bucket}, ${bucket+1}[ kVA`}
                    style={{
                      flex: 1,
                      height: 24,
                      borderRadius: 4,
                      backgroundColor: count > 0 ? `rgba(${baseColor}, ${0.2 + 0.8 * intensity})` : "rgba(255,255,255,0.03)",
                      border: count > 0 ? `1px solid rgba(${baseColor}, 0.5)` : "1px solid transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: count > 0 ? "#fff" : "transparent",
                      minWidth: 24
                    }}
                  >
                    {count > 0 ? count : ""}
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
            <div style={{ width: 60 }}></div>
            {MONTHS_LABELS.map((label, idx) => (
              <div key={idx} style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#94a3b8", minWidth: 24 }}>
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
