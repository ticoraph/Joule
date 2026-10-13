import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { DailyReading } from "../types";

// ─── helpers ────────────────────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
  // dateStr is "YYYY-MM-DD"
  return new Date(`${dateStr}T00:00:00Z`);
}

/** Return "MM-DD" from "YYYY-MM-DD" */
function mmdd(dateStr: string): string {
  return dateStr.slice(5);
}

/** Compute day-of-year index 0..365 for a YYYY-MM-DD string */
function dayOfYear(dateStr: string): number {
  const d = parseDate(dateStr);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

/** Rolling-window percentile: for each position i, look at i ± windowRadius
 *  entries in the *sorted-by-date* array, collect non-null values, return p90 */
function rollingP90(
  sorted: { date: string; value: number | null }[],
  windowRadius = 15,
): (number | null)[] {
  return sorted.map((_, i) => {
    const lo = Math.max(0, i - windowRadius);
    const hi = Math.min(sorted.length - 1, i + windowRadius);
    const vals: number[] = [];
    for (let j = lo; j <= hi; j++) {
      const v = sorted[j].value;
      if (v !== null && v !== undefined) vals.push(v);
    }
    if (vals.length === 0) return null;
    vals.sort((a, b) => a - b);
    // p90
    const idx = Math.floor(vals.length * 0.9);
    return vals[Math.min(idx, vals.length - 1)];
  });
}

/** Light 7-day rolling average smoother (to make the reference curve silky) */
function rollingAvg(values: (number | null)[], radius = 7): (number | null)[] {
  return values.map((_, i) => {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(values.length - 1, i + radius);
    const vals: number[] = [];
    for (let j = lo; j <= hi; j++) {
      const v = values[j];
      if (v !== null) vals.push(v);
    }
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });
}

// ─── chart data builder ──────────────────────────────────────────────────────

interface EcoFlowPoint {
  date: string;       // "YYYY-MM-DD"
  label: string;      // short label for x-axis
  production: number | null;
  solarToHome: number | null;
  solarToBattery: number | null;
  maxPotential: number | null;
  sunMinutes: number | null;
  yieldKwhPerH: number | null;
  residual: number | null;
  precip: number | null;
}

// Rolling 12-month window ending on the last day of the previous month (the data is refreshed
// monthly, so the current month is always incomplete), e.g. on 2026-10-15: 2025-10-01 → 2026-09-30
function isoLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function frDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const today = new Date();
const ECO_START = isoLocal(new Date(today.getFullYear(), today.getMonth() - 12, 1));
const ECO_END   = isoLocal(new Date(today.getFullYear(), today.getMonth(), 0));
const ECO_RANGE_LABEL = `${frDate(ECO_START)} → ${frDate(ECO_END)}`;

const PRICE_HP = 0.2132; // ENE_Price_kWh_HP_Euro

function buildEcoFlowData(readings: DailyReading[]): EcoFlowPoint[] {
  // 1. Filter to the target window
  const window = readings.filter((r) => r.date >= ECO_START && r.date <= ECO_END);

  // 2. Build a sorted array of (date, production) over ALL available history
  //    so we can compute the seasonal max potential across multiple years
  const allProduction = readings
    .filter((r) => r.eco_solartotalgeneration !== null)
    .map((r) => ({ date: r.date, value: r.eco_solartotalgeneration as number }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 3. Build a lookup: mmdd → all observed production values
  const byMMDD = new Map<string, number[]>();
  for (const { date, value } of allProduction) {
    const key = mmdd(date);
    const arr = byMMDD.get(key) ?? [];
    arr.push(value);
    byMMDD.set(key, arr);
  }

  // 4. For each target day, compute seasonal P95 using a ±5-day calendar window
  //    (we look at the same calendar period across all available years)
  const calendarP95 = (dateStr: string): number | null => {
    const [, mStr, dStr] = dateStr.split("-");
    const month = parseInt(mStr, 10);
    const day = parseInt(dStr, 10);

    // Build candidate MM-DD keys within ±5 days (wrapping over year boundary)
    const vals: number[] = [];
    for (let delta = -5; delta <= 5; delta++) {
      const d = new Date(Date.UTC(2000, month - 1, day + delta)); // leap-safe with 2000
      const key = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      const arr = byMMDD.get(key);
      if (arr) vals.push(...arr);
    }
    if (vals.length === 0) return null;
    vals.sort((a, b) => a - b);
    const idx = Math.floor(vals.length * 0.95);
    return vals[Math.min(idx, vals.length - 1)];
  };

  // 5. Build the final chart data
  return window.map((r) => {
    const production = r.eco_solartotalgeneration;
    const p90 = calendarP95(r.date);
    const maxPotential =
      p90 !== null && production !== null
        ? Math.max(p90, production)
        : p90 ?? production;

    return {
      date: r.date,
      label: r.date.slice(5), // "MM-DD"
      production,
      solarToHome: r.eco_solartohome,
      solarToBattery: r.eco_solartobattery,
      maxPotential,
      sunMinutes: r.sun_daylight_minute,
      yieldKwhPerH: r.eco_kwh_per_daylighthour,
      residual: r.eco_actual_prod_minus_expected,
      precip: r.cli_precip,
    };
  });
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, name?: string): string {
  if (v == null) return "-";
  const numStr = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v);
  if (name?.includes("min")) return numStr + " min";
  if (name?.includes("Rendement")) return numStr + " kWh/h";
  if (name?.includes("Précipitation")) return numStr + " mm";
  return numStr + " kWh";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "rgba(15,23,42,0.92)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: "10px 14px",
        color: "#fff",
        fontSize: 13,
        backdropFilter: "blur(8px)",
      }}
    >
      <p style={{ fontWeight: 700, marginBottom: 6, color: "#94a3b8" }}>{label}</p>
      {payload.map((entry: { name: string; value: number; color: string }) => (
        <div key={entry.name} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: entry.color, flexShrink: 0 }} />
          <span style={{ color: "#cbd5e1" }}>{entry.name}:</span>
          <span style={{ fontWeight: 600, color: "#fff" }}>{fmt(entry.value, entry.name)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Stats cards ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 14,
        padding: "18px 22px",
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
      }}
    >
      <div style={{ fontSize: 12, color: "#94a3b8", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── X-axis tick (show only first of month) ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MonthTick(props: any) {
  const { x, y, payload } = props;
  const label: string = payload?.value ?? "";
  if (!label.endsWith("01")) return null;
  const monthNames: Record<string, string> = {
    "07": "Juil", "08": "Août", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
    "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr", "05": "Mai", "06": "Juin",
  };
  const month = monthNames[label.slice(0, 2)] ?? label;
  return (
    <text x={x} y={y + 14} textAnchor="middle" fill="#64748b" fontSize={12} fontWeight={600}>
      {month}
    </text>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function EcoFlow() {
  const { data, isLoading } = useQuery({
    queryKey: ["readings", "daily"],
    queryFn: () => api<DailyReading[]>("/readings/daily"),
  });

  const chartData = buildEcoFlowData(data ?? []);

  // Stats
  const totalProduction = chartData.reduce((s, p) => s + (p.production ?? 0), 0);
  const maxDay = chartData.reduce(
    (best, p) => (p.production != null && p.production > (best.production ?? 0) ? p : best),
    chartData[0] ?? { production: null, date: "" },
  );
  const avgProduction =
    chartData.filter((p) => p.production != null).length > 0
      ? totalProduction / chartData.filter((p) => p.production != null).length
      : 0;
  const maxPotentialTotal = chartData.reduce((s, p) => s + (p.maxPotential ?? 0), 0);
  const solarEfficiency =
    maxPotentialTotal > 0 ? Math.round((totalProduction / maxPotentialTotal) * 100) : null;
  const gains = totalProduction * PRICE_HP;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0f2942 100%)",
        padding: "32px 24px",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "linear-gradient(135deg, #f59e0b, #fbbf24)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              boxShadow: "0 4px 16px rgba(245,158,11,0.4)",
            }}
          >
            ☀️
          </div>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "#f1f5f9", margin: 0, lineHeight: 1.2 }}>
              Analyse EcoFlow
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
              Production solaire · {ECO_RANGE_LABEL}
            </p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <StatCard
          label="Production totale"
          value={`${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(totalProduction)} kWh`}
          sub={ECO_RANGE_LABEL}
          color="#fbbf24"
        />
        <StatCard
          label="Moyenne journalière"
          value={`${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(avgProduction)} kWh`}
          sub="sur les jours avec données"
          color="#34d399"
        />
        <StatCard
          label="Meilleur jour"
          value={`${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(maxDay?.production ?? 0)} kWh`}
          sub={maxDay?.date ?? ""}
          color="#60a5fa"
        />
        <StatCard
          label="Efficacité solaire"
          value={solarEfficiency != null ? `${solarEfficiency} %` : "-"}
          sub="vs. potentiel max estimé"
          color={solarEfficiency != null && solarEfficiency >= 70 ? "#34d399" : "#f87171"}
        />
        <StatCard
          label="Gains"
          value={`${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(gains)} €`}
          sub="Production × tarif HP"
          color="#facc15"
        />
      </div>

      {/* Main chart */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 18,
          padding: "24px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
          marginBottom: 24,
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Production journalière — Solaire total
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
            Données réelles vs. potentiel max estimé (P90 sur fenêtre calendaire ±10 j toutes années)
          </p>
        </div>

        {isLoading ? (
          <div style={{ height: 420, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
            Chargement des données…
          </div>
        ) : (
          <div style={{ height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <defs>
                  <linearGradient id="prodGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="maxGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  tick={<MonthTick />}
                  interval={0}
                  axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  unit=" kWh"
                  tick={{ fill: "#64748b", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={65}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  unit=" min"
                  tick={{ fill: "#4ade80", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  formatter={(value) => (
                    <span style={{ color: "#94a3b8", fontSize: 13 }}>{value}</span>
                  )}
                />

                {/* Max potential area (background reference) */}
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="maxPotential"
                  name="Potentiel max (P95)"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  fill="url(#maxGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#60a5fa" }}
                />

                {/* Actual production */}
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="production"
                  name="Production totale (kWh)"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  fill="url(#prodGrad)"
                  dot={false}
                  activeDot={{ r: 5, fill: "#fbbf24" }}
                />

                {/* Sunshine duration */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="sunMinutes"
                  name="Ensoleillement (min)"
                  stroke="#4ade80"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4, fill: "#4ade80" }}
                />


              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Secondary chart: Rendement & Résidus */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 18,
          padding: "24px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
          marginBottom: 24,
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Analyse Avancée — Rendement & Impact Météo
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
            Rendement (kWh par heure d'ensoleillement) et Résidus (sur/sous-performance vs tendance annuelle)
          </p>
        </div>

        {isLoading ? (
          <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
            Chargement des données…
          </div>
        ) : (
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  tick={<MonthTick />}
                  interval={0}
                  axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  unit=" kWh"
                  tick={{ fill: "#64748b", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={65}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  unit=" /h"
                  tick={{ fill: "#d946ef", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <YAxis
                  yAxisId="precip"
                  orientation="right"
                  unit=" mm"
                  tick={{ fill: "#38bdf8", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={55}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  formatter={(value) => (
                    <span style={{ color: "#94a3b8", fontSize: 13 }}>{value}</span>
                  )}
                />

                {/* Précipitations (area chart en arrière-plan) */}
                <Area
                  yAxisId="precip"
                  type="monotone"
                  dataKey="precip"
                  name="Précipitations"
                  stroke="#38bdf8"
                  strokeWidth={0}
                  fill="#38bdf8"
                  fillOpacity={0.4}
                  dot={false}
                  activeDot={false}
                />

                {/* Résidus (bar chart) */}
                <Bar yAxisId="left" dataKey="residual" name="Résidu météo (kWh)">
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={(entry.residual ?? 0) > 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>

                {/* Rendement (line chart) */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="yieldKwhPerH"
                  name="Rendement (kWh/h)"
                  stroke="#d946ef"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#d946ef" }}
                />
                
                <ReferenceLine yAxisId="left" y={0} stroke="rgba(255,255,255,0.2)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Explanation card */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(96,165,250,0.08), rgba(96,165,250,0.02))",
          border: "1px solid rgba(96,165,250,0.2)",
          borderRadius: 14,
          padding: "18px 22px",
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#93c5fd", margin: "0 0 8px" }}>
          ℹ️ Comment est calculé le potentiel max ?
        </h3>
        <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, lineHeight: 1.7 }}>
          Pour chaque jour de l'année (ex. 15 juillet), on regarde la production observée sur une fenêtre calendaire
          de ±5 jours autour de cette date, <strong style={{ color: "#cbd5e1" }}>toutes années confondues</strong>.
          On retient le <strong style={{ color: "#cbd5e1" }}>percentile 95</strong> de ces valeurs : c'est la production
          d'un <em>très bon jour de soleil</em> pour cette période de l'année — proche du maximum absolu sans être un outlier.
          La zone bleue pointillée représente donc ce plafond réaliste sur l'année solaire.
          L'écart entre la courbe jaune (réel) et la zone bleue (potentiel) visualise les jours nuageux.
        </p>
      </div>
    </div>
  );
}
