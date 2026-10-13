import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  Area,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { DailyReading } from "../types";

export default function Climat() {
  const { data, isLoading } = useQuery({
    queryKey: ["readings", "daily"],
    queryFn: () => api<DailyReading[]>("/readings/daily"),
  });

  if (isLoading) {
    return <div className="p-8 text-white">Chargement des données Climat...</div>;
  }

  // Ensure chronological order
  const sortedData = [...(data || [])].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const chartData = sortedData
    .map((r) => {
      const isSnow = r.cli_tempmoy != null && r.cli_tempmoy < 2 && r.cli_precip != null && r.cli_precip > 0;
      return {
        date: r.date,
        tempRange: r.cli_tempmin != null && r.cli_tempmax != null ? [r.cli_tempmin, r.cli_tempmax] : undefined,
        tempMoy: r.cli_tempmoy,
        precip: r.cli_precip,
        precipRain: isSnow ? 0 : r.cli_precip,
        precipSnow: isSnow ? r.cli_precip : 0,
      };
    })
    .filter(
      (r) =>
        r.tempRange !== undefined ||
        r.tempMoy != null ||
        r.precip != null
    )
    .slice(-365);

  const years = Array.from(new Set(sortedData.map(d => d.date?.substring(0, 4)).filter(Boolean)));
  const seasonStats = years.map(year => {
    const yearData = sortedData.filter(d => d.date?.startsWith(year));
    const eteData = yearData.filter(d => {
       const m = parseInt(d.date.substring(5, 7), 10);
       return m >= 4 && m <= 9;
    });
    const hiverData = yearData.filter(d => {
       const m = parseInt(d.date.substring(5, 7), 10);
       return m < 4 || m > 9;
    });

    const getAvg = (arr: any[], key: string) => arr.length ? arr.reduce((sum, item) => sum + (item[key] || 0), 0) / arr.length : 0;
    const getAvgAmp = (arr: any[]) => arr.length ? arr.reduce((sum, item) => sum + ((item.cli_tempmax || 0) - (item.cli_tempmin || 0)), 0) / arr.length : 0;

    return {
       year,
       ete_temp: parseFloat(getAvg(eteData, 'cli_tempmoy').toFixed(1)),
       ete_amp: parseFloat(getAvgAmp(eteData).toFixed(1)),
       ete_precip: parseFloat(getAvg(eteData, 'cli_precip').toFixed(1)),
       hiver_temp: parseFloat(getAvg(hiverData, 'cli_tempmoy').toFixed(1)),
       hiver_amp: parseFloat(getAvgAmp(hiverData).toFixed(1)),
       hiver_precip: parseFloat(getAvg(hiverData, 'cli_precip').toFixed(1))
    };
  }).filter(stat => stat.ete_temp > 0 || stat.hiver_temp > 0);

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
              background: "linear-gradient(135deg, #3b82f6, #2563eb)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: "0 4px 20px rgba(59,130,246,0.45)",
              flexShrink: 0,
            }}
          >
            🌤️
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#f8fafc", margin: 0 }}>
            Analyse du Climat
          </h1>
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
            Tendances Météorologiques
          </h2>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 4 }}>
            Températures (Max, Min, Moy) et Précipitations
          </p>
        </div>

        <div className="h-96" style={{ height: 500 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
                tickFormatter={(val) => {
                  if (!val) return "";
                  const d = new Date(val);
                  return d.toLocaleDateString("fr-FR", { month: "short", day: "numeric" });
                }}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: "#f8fafc", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
                label={{ value: "Température (°C)", angle: -90, position: "insideLeft", fill: "#f8fafc" }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "#60a5fa", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
                label={{ value: "Précipitations (mm)", angle: 90, position: "insideRight", fill: "#60a5fa" }}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(15,23,42,0.9)",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                itemStyle={{ color: "#e2e8f0" }}
                labelStyle={{ fontWeight: "bold", color: "#f8fafc", marginBottom: 8 }}
                labelFormatter={(label) => {
                  if (!label) return "";
                  return new Date(label).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  });
                }}
                formatter={(value: any, name: string) => {
                  if (Array.isArray(value)) {
                    return [`${value[0]}°C - ${value[1]}°C`, name];
                  }
                  return [value, name];
                }}
              />
              <Legend wrapperStyle={{ paddingTop: "20px" }} />
              
              <Bar
                yAxisId="right"
                dataKey="precipRain"
                stackId="a"
                name="Précipitations"
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
                barSize={20}
                opacity={0.4}
              />
              <Bar
                yAxisId="right"
                dataKey="precipSnow"
                stackId="a"
                name="Neige"
                fill="#ffffff"
                radius={[4, 4, 0, 0]}
                barSize={20}
                opacity={0.8}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="tempRange"
                name="Amplitude Thermique"
                stroke="none"
                fill="#f59e0b"
                fillOpacity={0.15}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="tempMoy"
                name="Température Moyenne"
                stroke="#f59e0b"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 6 }}
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
          marginTop: 32,
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Relation Précipitations / Température
          </h2>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 4 }}>
            Chaque point représente une journée de l'année. Permet d'identifier rapidement la pluie par temps froid ou chaud.
          </p>
        </div>

        <div className="h-96" style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                type="number"
                dataKey="tempMoy"
                name="Température"
                unit=" °C"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
              />
              <YAxis
                type="number"
                dataKey="precip"
                name="Précipitations"
                unit=" mm"
                tick={{ fill: "#60a5fa", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
                label={{ value: "Précipitations (mm)", angle: -90, position: "insideLeft", fill: "#60a5fa" }}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(15,23,42,0.9)",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                itemStyle={{ color: "#e2e8f0" }}
                formatter={(value: any, name: string) => [value, name]}
                labelFormatter={() => ""}
              />
              <Scatter
                name="Jours"
                data={chartData.filter(d => d.tempMoy != null && d.precip != null && d.precip > 0)}
              >
                {chartData
                  .filter((d) => d.tempMoy != null && d.precip != null && d.precip > 0)
                  .map((entry, index) => {
                    let fill = "#3b82f6"; // par défaut (< 10)
                    if (entry.tempMoy! > 25) fill = "#ef4444";
                    else if (entry.tempMoy! > 20) fill = "#f97316";
                    else if (entry.tempMoy! > 15) fill = "#8b4513";
                    else if (entry.tempMoy! > 10) fill = "#9ca3af";
                    return <Cell key={`cell-${index}`} fill={fill} fillOpacity={0.8} />;
                  })}
              </Scatter>
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
          marginTop: 32,
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Tendances Saisonnières : Été (Avr-Sep) vs Hiver (Oct-Mar)
          </h2>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 4 }}>
            Évolution annuelle des températures moyennes, amplitudes thermiques et précipitations journalières par saison.
          </p>
        </div>

        <div className="h-96" style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={seasonStats} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey="year"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: "#f8fafc", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
                label={{ value: "Température (°C)", angle: -90, position: "insideLeft", fill: "#f8fafc" }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "#60a5fa", fontSize: 12 }}
                stroke="rgba(255,255,255,0.2)"
                label={{ value: "Précip. moy. (mm/j)", angle: 90, position: "insideRight", fill: "#60a5fa" }}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(15,23,42,0.9)",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
                itemStyle={{ color: "#e2e8f0" }}
                labelStyle={{ fontWeight: "bold", color: "#f8fafc", marginBottom: 8 }}
              />
              <Legend wrapperStyle={{ paddingTop: "20px" }} />
              
              <Bar yAxisId="right" dataKey="ete_precip" name="Pluie Été (mm/j)" fill="#fca5a5" barSize={20} opacity={0.6} />
              <Bar yAxisId="right" dataKey="hiver_precip" name="Pluie Hiver (mm/j)" fill="#93c5fd" barSize={20} opacity={0.6} />
              
              <Line yAxisId="left" type="monotone" dataKey="ete_temp" name="Temp Moy Été" stroke="#ef4444" strokeWidth={3} />
              <Line yAxisId="left" type="monotone" dataKey="hiver_temp" name="Temp Moy Hiver" stroke="#3b82f6" strokeWidth={3} />
              
              <Line yAxisId="left" type="monotone" dataKey="ete_amp" name="Amplitude Été" stroke="#f97316" strokeDasharray="5 5" strokeWidth={2} />
              <Line yAxisId="left" type="monotone" dataKey="hiver_amp" name="Amplitude Hiver" stroke="#60a5fa" strokeDasharray="5 5" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
