import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { DailyReading } from "../types";

// ─── Constants ───────────────────────────────────────────────────────────────

const ENEDIS_START = "2023-04-01";
const ENEDIS_END   = "2026-09-30";

type FilterMode = "HC" | "HP" | "HC+HP";

// ─── Semester definition ─────────────────────────────────────────────────────

interface SemesterDef {
  label: string;
  shortLabel: string;
  start: string; // "YYYY-MM-DD"
  end: string;
  type: "oct-mar" | "avr-sep";
}

const SEMESTERS: SemesterDef[] = [
  // OCT–MAR group first
  { label: "OCT 2023 – MAR 2024", shortLabel: "Oct23–Mar24", start: "2023-10-01", end: "2024-03-31", type: "oct-mar" },
  { label: "OCT 2024 – MAR 2025", shortLabel: "Oct24–Mar25", start: "2024-10-01", end: "2025-03-31", type: "oct-mar" },
  { label: "OCT 2025 – MAR 2026", shortLabel: "Oct25–Mar26", start: "2025-10-01", end: "2026-03-31", type: "oct-mar" },
  // AVR–SEP group
  { label: "AVR – SEP 2023", shortLabel: "Avr–Sep 2023", start: "2023-04-01", end: "2023-09-30", type: "avr-sep" },
  { label: "AVR – SEP 2024", shortLabel: "Avr–Sep 2024", start: "2024-04-01", end: "2024-09-30", type: "avr-sep" },
  { label: "AVR – SEP 2025", shortLabel: "Avr–Sep 2025", start: "2025-04-01", end: "2025-09-30", type: "avr-sep" },
  { label: "AVR – SEP 2026", shortLabel: "Avr–Sep 2026", start: "2026-04-01", end: "2026-09-30", type: "avr-sep" },
];

// ─── Colors ──────────────────────────────────────────────────────────────────

// OCT-MAR = cool blues, AVR-SEP = warm ambers
const COLORS_OCT_MAR_HC = ["#60a5fa", "#3b82f6", "#1d4ed8"];
const COLORS_OCT_MAR_HP = ["#93c5fd", "#bfdbfe", "#dbeafe"];
const COLORS_AVR_SEP_HC = ["#f59e0b", "#d97706", "#b45309", "#92400e"];
const COLORS_AVR_SEP_HP = ["#fcd34d", "#fde68a", "#fef3c7", "#fffbeb"];

// ─── Data builder ─────────────────────────────────────────────────────────────

interface SemesterData {
  label: string;
  shortLabel: string;
  type: "oct-mar" | "avr-sep";
  hc: number;        // HC brut - TES_HomeKwh (net)
  hp: number;
  hcBrut: number;
  tesHome: number;
  hasTes: boolean;   // whether TES data exists
}

function buildSemesterData(readings: DailyReading[]): SemesterData[] {
  const filtered = readings.filter(
    (r) => r.date >= ENEDIS_START && r.date <= ENEDIS_END
  );

  return SEMESTERS.map((sem) => {
    const rows = filtered.filter((r) => r.date >= sem.start && r.date <= sem.end);

    const hcBrut  = rows.reduce((s, r) => s + (r.ene_hc_byday ?? 0), 0);
    const hp      = rows.reduce((s, r) => s + (r.ene_hp_byday ?? 0), 0);
    const tesHome = rows.reduce((s, r) => s + (r.tes_homekwh ?? 0), 0);
    const hasTes  = tesHome > 0;
    const hc      = Math.max(0, hcBrut - tesHome);

    return {
      label: sem.label,
      shortLabel: sem.shortLabel,
      type: sem.type,
      hc,
      hp,
      hcBrut,
      tesHome,
      hasTes,
    };
  });
}

// ─── Number formatter ─────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmt(v: number | null | undefined, unit = " kWh"): string {
  if (v == null) return "-";
  return (
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) +
    unit
  );
}

function fmtShort(v: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
}

function avgWinterAndSummer(
  winter: SemesterData[],
  summer: SemesterData[],
  key: keyof Pick<SemesterData, "hc" | "hp" | "hcBrut" | "tesHome">
): { hiver: number; ete: number } {
  const hiver = winter.length ? winter.reduce((s, d) => s + d[key], 0) / winter.length : 0;
  const ete = summer.length ? summer.reduce((s, d) => s + d[key], 0) / summer.length : 0;
  return { hiver, ete };
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label, mode }: any) {
  if (!active || !payload?.length) return null;

  // Find matching semester for extra info
  const sem = payload[0]?.payload as SemesterData | undefined;

  return (
    <div
      style={{
        background: "rgba(15,23,42,0.95)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        padding: "12px 16px",
        color: "#fff",
        fontSize: 13,
        backdropFilter: "blur(12px)",
        minWidth: 220,
      }}
    >
      <p style={{ fontWeight: 700, marginBottom: 8, color: "#94a3b8", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </p>

      {payload.map((entry: { name: string; value: number; color: string }) => (
        <div key={entry.name} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
            <span style={{ color: "#cbd5e1" }}>{entry.name}</span>
          </div>
          <span style={{ fontWeight: 700, color: "#fff" }}>{fmtShort(entry.value)} kWh</span>
        </div>
      ))}

      {/* TES deduction detail */}
      {sem && (mode === "HC" || mode === "HC+HP") && sem.hasTes && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            fontSize: 11,
            color: "#64748b",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>HC brut</span>
            <span>{fmtShort(sem.hcBrut)} kWh</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>− Tesla Home (TES)</span>
            <span style={{ color: "#f87171" }}>− {fmtShort(sem.tesHome)} kWh</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stat Card ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  valueEte,
  valueHiver,
  sub,
  color,
  icon,
}: {
  label: string;
  valueEte: string;
  valueHiver: string;
  sub?: string;
  color: string;
  icon: string;
}) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 16,
        padding: "20px 24px",
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>
          {label}
        </span>
      </div>
      <div style={{ display: "flex", gap: 18 }}>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
            Été
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1 }}>{valueEte}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
            Hiver
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1 }}>{valueHiver}</div>
        </div>
      </div>
      {sub && <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Bar color helper ─────────────────────────────────────────────────────────

function getBarColor(type: "oct-mar" | "avr-sep", index: number, channel: "hc" | "hp"): string {
  if (type === "oct-mar") {
    return channel === "hc" ? COLORS_OCT_MAR_HC[index] : COLORS_OCT_MAR_HP[index];
  }
  return channel === "hc" ? COLORS_AVR_SEP_HC[index] : COLORS_AVR_SEP_HP[index];
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Enedis() {
  const [mode, setMode] = useState<FilterMode>("HC+HP");

  const { data, isLoading } = useQuery({
    queryKey: ["readings", "daily"],
    queryFn: () => api<DailyReading[]>("/readings/daily"),
  });

  const semesterData = buildSemesterData(data ?? []);

  // Split by group
  const octMarData = semesterData.filter((s) => s.type === "oct-mar");
  const avrSepData = semesterData.filter((s) => s.type === "avr-sep");

  // Summary stats
  const totalHC   = semesterData.reduce((s, d) => s + d.hc, 0);
  const totalHP   = semesterData.reduce((s, d) => s + d.hp, 0);
  const totalTes  = semesterData.reduce((s, d) => s + d.tesHome, 0);
  const totalAll  = totalHC + totalHP;

  // Semester averages (Été = avr-sep, Hiver = oct-mar) - averages rather than sums, since the
  // two groups don't always have the same number of semesters
  const avgHC = avgWinterAndSummer(octMarData, avrSepData, "hc");
  const avgHP = avgWinterAndSummer(octMarData, avrSepData, "hp");
  const avgHCBrut = avgWinterAndSummer(octMarData, avrSepData, "hcBrut");
  const avgTes = avgWinterAndSummer(octMarData, avrSepData, "tesHome");
  const avgTotal = { hiver: avgHC.hiver + avgHP.hiver, ete: avgHC.ete + avgHP.ete };
  const diffHCBrut = avgHCBrut.hiver - avgHCBrut.ete;
  const diffTes = avgTes.hiver - avgTes.ete;
  const diffHC = avgHC.hiver - avgHC.ete;
  const diffHP = avgHP.hiver - avgHP.ete;
  const diffAll = avgTotal.hiver - avgTotal.ete;
  const avgRatio = {
    hiver: avgHP.hiver > 0 ? (avgHC.hiver / avgHP.hiver) * 100 : 0,
    ete: avgHP.ete > 0 ? (avgHC.ete / avgHP.ete) * 100 : 0,
  };

  // Build chart data with group separator
  const chartData: (SemesterData & { _separator?: boolean })[] = [
    ...octMarData,
    { label: "", shortLabel: "   ", type: "oct-mar", hc: 0, hp: 0, hcBrut: 0, tesHome: 0, hasTes: false, _separator: true },
    ...avrSepData,
  ];

  // Bar fills per row
  const octMarHcColors = octMarData.map((_, i) => COLORS_OCT_MAR_HC[i] ?? "#60a5fa");
  const octMarHpColors = octMarData.map((_, i) => COLORS_OCT_MAR_HP[i] ?? "#93c5fd");
  const avrSepHcColors = avrSepData.map((_, i) => COLORS_AVR_SEP_HC[i] ?? "#f59e0b");
  const avrSepHpColors = avrSepData.map((_, i) => COLORS_AVR_SEP_HP[i] ?? "#fcd34d");

  // For recharts Cell, we need per-item color arrays
  const hcColors = [
    ...octMarHcColors,
    "transparent",
    ...avrSepHcColors,
  ];
  const hpColors = [
    ...octMarHpColors,
    "transparent",
    ...avrSepHpColors,
  ];

  const showHC = mode === "HC" || mode === "HC+HP";
  const showHP = mode === "HP" || mode === "HC+HP";

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
              background: "linear-gradient(135deg, #6366f1, #4f46e5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: "0 4px 20px rgba(99,102,241,0.45)",
              flexShrink: 0,
            }}
          >
            ⚡
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
              Analyse Enedis
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0, marginTop: 2 }}>
              Consommation électrique · {fmtDate(ENEDIS_START)} → {fmtDate(ENEDIS_END)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <StatCard
          label="Consommation totale"
          valueEte={fmt(avgTotal.ete)}
          valueHiver={fmt(avgTotal.hiver)}
          sub="HC net + HP · moyenne / semestre"
          color="#a78bfa"
          icon="⚡"
        />
        <StatCard
          label="HC nette (Tesla déduite)"
          valueEte={fmt(avgHC.ete)}
          valueHiver={fmt(avgHC.hiver)}
          sub={`Brut : Été ${fmt(avgHCBrut.ete)} / Hiver ${fmt(avgHCBrut.hiver)} · TES : −Été ${fmt(avgTes.ete)} / −Hiver ${fmt(avgTes.hiver)}`}
          color="#60a5fa"
          icon="🌙"
        />
        <StatCard
          label="HP"
          valueEte={fmt(avgHP.ete)}
          valueHiver={fmt(avgHP.hiver)}
          sub="Heures Pleines · moyenne / semestre"
          color="#fbbf24"
          icon="☀️"
        />
        <StatCard
          label="Ratio HC / HP"
          valueEte={avgHP.ete > 0 ? `${Math.round(avgRatio.ete)} %` : "-"}
          valueHiver={avgHP.hiver > 0 ? `${Math.round(avgRatio.hiver)} %` : "-"}
          sub="HC nette vs HP"
          color="#34d399"
          icon="📊"
        />
      </div>

      {/* ── Chart Card ─────────────────────────────────────────────────────── */}
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
        {/* Chart header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
              Consommation semestrielle
            </h2>
            <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
              Groupé par semestre · <span style={{ color: "#60a5fa" }}>■ Oct–Mar</span> &nbsp;
              <span style={{ color: "#f59e0b" }}>■ Avr–Sep</span>
            </p>
          </div>

          {/* Filter selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label
              htmlFor="enedis-mode"
              style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}
            >
              Afficher
            </label>
            <select
              id="enedis-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as FilterMode)}
              style={{
                background: "rgba(30,41,59,0.9)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                color: "#e2e8f0",
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 32px 7px 12px",
                outline: "none",
                cursor: "pointer",
                appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 10px center",
              }}
            >
              <option value="HC">🌙 HC — Heures Creuses (nettes)</option>
              <option value="HP">☀️ HP — Heures Pleines</option>
              <option value="HC+HP">⚡ HC + HP (les deux)</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div
            style={{
              height: 420,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748b",
              gap: 12,
              fontSize: 15,
            }}
          >
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⚡</span>
            Chargement des données…
          </div>
        ) : (
          <div style={{ height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 16, left: 0, bottom: 20 }}
                barCategoryGap="20%"
                barGap={4}
              >
                <defs>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.06)"
                  vertical={false}
                />

                <XAxis
                  dataKey="shortLabel"
                  tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                  tickLine={false}
                  interval={0}
                />

                <YAxis
                  unit=" kWh"
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={72}
                />

                <Tooltip
                  content={<CustomTooltip mode={mode} />}
                  cursor={{ fill: "rgba(255,255,255,0.04)", radius: 6 }}
                />

                <Legend
                  formatter={(value) => (
                    <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>{value}</span>
                  )}
                  wrapperStyle={{ paddingTop: 12 }}
                />

                {/* HC bars */}
                {showHC && (
                  <Bar dataKey="hc" name="HC nette (kWh)" radius={[6, 6, 0, 0]} maxBarSize={64}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`hc-${index}`}
                        fill={hcColors[index] ?? "#60a5fa"}
                        fillOpacity={entry._separator ? 0 : 1}
                      />
                    ))}
                  </Bar>
                )}

                {/* HP bars */}
                {showHP && (
                  <Bar dataKey="hp" name="HP (kWh)" radius={[6, 6, 0, 0]} maxBarSize={64}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`hp-${index}`}
                        fill={hpColors[index] ?? "#fbbf24"}
                        fillOpacity={entry._separator ? 0 : 1}
                      />
                    ))}
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Detail table ─────────────────────────────────────────────────── */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: "20px 24px",
          backdropFilter: "blur(12px)",
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", margin: "0 0 16px", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Détail par semestre
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Semestre", "HC brut", "− Tesla (TES)", "HC nette", "HP", "Total"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === "Semestre" ? "left" : "right",
                      padding: "8px 12px",
                      color: "#64748b",
                      fontWeight: 600,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      borderBottom: "1px solid rgba(255,255,255,0.07)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {semesterData.map((s, i) => (
                <tr
                  key={s.label}
                  style={{
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                  }}
                >
                  <td style={{ padding: "10px 12px", color: "#e2e8f0", fontWeight: 600 }}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        marginRight: 8,
                        background: s.type === "oct-mar"
                          ? getBarColor("oct-mar", octMarData.indexOf(s), "hc")
                          : getBarColor("avr-sep", avrSepData.indexOf(s), "hc"),
                        verticalAlign: "middle",
                      }}
                    />
                    {s.label}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#94a3b8", textAlign: "right" }}>
                    {fmtShort(s.hcBrut)}
                  </td>
                  <td style={{ padding: "10px 12px", color: s.hasTes ? "#f87171" : "#475569", textAlign: "right" }}>
                    {s.hasTes ? `− ${fmtShort(s.tesHome)}` : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#60a5fa", fontWeight: 700, textAlign: "right" }}>
                    {fmtShort(s.hc)}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#fbbf24", fontWeight: 700, textAlign: "right" }}>
                    {fmtShort(s.hp)}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#a78bfa", fontWeight: 700, textAlign: "right" }}>
                    {fmtShort(s.hc + s.hp)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                <td style={{ padding: "10px 12px", color: "#f1f5f9", fontWeight: 700 }}>Moyenne HIVER / semestre ({octMarData.length})</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8", fontWeight: 700, textAlign: "right" }}>
                  {fmtShort(avgHCBrut.hiver)}
                </td>
                <td style={{ padding: "10px 12px", color: "#f87171", fontWeight: 700, textAlign: "right" }}>
                  − {fmtShort(avgTes.hiver)}
                </td>
                <td style={{ padding: "10px 12px", color: "#60a5fa", fontWeight: 700, textAlign: "right" }}>
                  {fmtShort(avgHC.hiver)}
                </td>
                <td style={{ padding: "10px 12px", color: "#fbbf24", fontWeight: 700, textAlign: "right" }}>
                  {fmtShort(avgHP.hiver)}
                </td>
                <td style={{ padding: "10px 12px", color: "#a78bfa", fontWeight: 700, textAlign: "right" }}>
                  {fmtShort(avgTotal.hiver)}
                </td>
              </tr>
              <tr style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "10px 12px", color: "#f1f5f9", fontWeight: 700 }}>Moyenne ÉTÉ / semestre ({avrSepData.length})</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8", fontWeight: 700, textAlign: "right" }}>
                  {fmtShort(avgHCBrut.ete)}
                </td>
                <td style={{ padding: "10px 12px", color: "#f87171", fontWeight: 700, textAlign: "right" }}>
                  − {fmtShort(avgTes.ete)}
                </td>
                <td style={{ padding: "10px 12px", color: "#60a5fa", fontWeight: 700, textAlign: "right" }}>
                  {fmtShort(avgHC.ete)}
                </td>
                <td style={{ padding: "10px 12px", color: "#fbbf24", fontWeight: 700, textAlign: "right" }}>
                  {fmtShort(avgHP.ete)}
                </td>
                <td style={{ padding: "10px 12px", color: "#a78bfa", fontWeight: 700, textAlign: "right" }}>
                  {fmtShort(avgTotal.ete)}
                </td>
              </tr>
              <tr style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "10px 12px", color: "#f1f5f9", fontWeight: 700 }}>HIVER - ÉTÉ (moyennes)</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8", fontWeight: 700, textAlign: "right" }}>
                  {diffHCBrut > 0 ? "+" : ""}{fmtShort(diffHCBrut)}
                </td>
                <td style={{ padding: "10px 12px", color: "#f87171", fontWeight: 700, textAlign: "right" }}>
                  {diffTes > 0 ? "+" : ""}{fmtShort(diffTes)}
                </td>
                <td style={{ padding: "10px 12px", color: "#60a5fa", fontWeight: 700, textAlign: "right" }}>
                  {diffHC > 0 ? "+" : ""}{fmtShort(diffHC)}
                </td>
                <td style={{ padding: "10px 12px", color: "#fbbf24", fontWeight: 700, textAlign: "right" }}>
                  {diffHP > 0 ? "+" : ""}{fmtShort(diffHP)}
                </td>
                <td style={{ padding: "10px 12px", color: "#a78bfa", fontWeight: 700, textAlign: "right" }}>
                  {diffAll > 0 ? "+" : ""}{fmtShort(diffAll)}
                </td>
              </tr>
              <tr style={{ borderTop: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)" }}>
                <td style={{ padding: "10px 12px", color: "#f1f5f9", fontWeight: 800 }}>TOTAL</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8", fontWeight: 700, textAlign: "right" }}>
                  {fmtShort(semesterData.reduce((s, d) => s + d.hcBrut, 0))}
                </td>
                <td style={{ padding: "10px 12px", color: "#f87171", fontWeight: 700, textAlign: "right" }}>
                  − {fmtShort(totalTes)}
                </td>
                <td style={{ padding: "10px 12px", color: "#60a5fa", fontWeight: 800, textAlign: "right" }}>
                  {fmtShort(totalHC)}
                </td>
                <td style={{ padding: "10px 12px", color: "#fbbf24", fontWeight: 800, textAlign: "right" }}>
                  {fmtShort(totalHP)}
                </td>
                <td style={{ padding: "10px 12px", color: "#a78bfa", fontWeight: 800, textAlign: "right" }}>
                  {fmtShort(totalAll)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Info card ────────────────────────────────────────────────────────── */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02))",
          border: "1px solid rgba(99,102,241,0.2)",
          borderRadius: 14,
          padding: "16px 20px",
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, color: "#a5b4fc", margin: "0 0 6px" }}>
          ℹ️ Méthode de calcul
        </h3>
        <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.7 }}>
          La <strong style={{ color: "#c7d2fe" }}>HC nette</strong> correspond aux Heures Creuses Enedis
          auxquelles on soustrait la consommation Tesla rechargée à domicile (
          <code style={{ color: "#818cf8", background: "rgba(99,102,241,0.15)", borderRadius: 4, padding: "1px 5px" }}>TES_HomeKwh</code>
          ) — ces kWh étant généralement rechargés de nuit en HC mais ne constituant pas
          de la consommation "maison" à proprement parler.
          Pour les semestres antérieurs à la disponibilité des données Tesla, la HC nette
          est égale à la HC brute.
        </p>
      </div>
    </div>
  );
}
