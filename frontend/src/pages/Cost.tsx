import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { DailyReading } from "../types";

// ─── Constants ───────────────────────────────────────────────────────────────

const PRICE_SUB = 23.68;
const PRICE_HC = 0.1251;
const PRICE_HP = 0.2132;

const ENEDIS_START = "2023-04-01";
const ENEDIS_END   = "2026-09-30";

// Appliances: annual kWh + HP/HC split, assumed spread evenly over the year
const DISHWASHER_KWH_YEAR = 270;
const DISHWASHER_HP_SHARE = 0.5;
const WASHING_MACHINE_KWH_YEAR = 110;
const WASHING_MACHINE_HP_SHARE = 0.75;
const FRIDGE_KWH_YEAR = 200;
const FRIDGE_HP_SHARE = 2 / 3;
const ELECTRONICS_KWH_YEAR = 720;
const ELECTRONICS_HP_SHARE = 2 / 3;

function applianceCost(kwhYear: number, hpShare: number, ratio: number): number {
  const kwh = kwhYear * ratio;
  return kwh * hpShare * PRICE_HP + kwh * (1 - hpShare) * PRICE_HC;
}

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

// ─── Data builder ─────────────────────────────────────────────────────────────

interface SemesterCostData {
  label: string;
  shortLabel: string;
  type: "oct-mar" | "avr-sep";
  costSub: number;
  costTesla: number;
  costHeating: number;
  costWaterHeater: number;
  costDishwasher: number;
  costWashingMachine: number;
  costFridge: number;
  costElectronics: number;
  costAppliances: number;
  costAutre: number;
  costTotalReal: number;
  solarGen: number;
  costSolar: number;
  _separator?: boolean;
}

function buildSemesterData(readings: DailyReading[]): SemesterCostData[] {
  const filtered = readings.filter(
    (r) => r.date >= ENEDIS_START && r.date <= ENEDIS_END
  );

  return SEMESTERS.map((sem) => {
    const rows = filtered.filter((r) => r.date >= sem.start && r.date <= sem.end);
    
    const ratio = Math.min(1, rows.length / 182.5); // prorate based on days available
    const costSub = (rows.length / 30.4) * PRICE_SUB; // exact subscription cost based on days

    const hcBrut  = rows.reduce((s, r) => s + (r.ene_hc_byday ?? 0), 0);
    const hp      = rows.reduce((s, r) => s + (r.ene_hp_byday ?? 0), 0);
    const tesHome = rows.reduce((s, r) => s + (r.tes_homekwh ?? 0), 0);
    const solarGen = rows.reduce((s, r) => s + (r.eco_solartotalgeneration ?? 0), 0);

    const costTotalReal = (hcBrut * PRICE_HC) + (hp * PRICE_HP) + costSub;
    const costTesla = tesHome * PRICE_HC;
    const costSolar = solarGen * PRICE_HP;

    let costHeating = 0;
    let costWaterHeater = 0;
    
    if (sem.type === "oct-mar") {
       // Heating: 2500 kWh/year (only in winter). 80% HC, 20% HP
       costHeating = ((2500 * 0.8 * PRICE_HC) + (2500 * 0.2 * PRICE_HP)) * ratio;
       // Water heater: 3200 total, 1750 in winter (100% HC)
       costWaterHeater = (1750 * PRICE_HC) * ratio;
    } else {
       // Water heater: 1450 in summer (100% HC)
       costWaterHeater = (1450 * PRICE_HC) * ratio;
    }

    const costDishwasher = applianceCost(DISHWASHER_KWH_YEAR, DISHWASHER_HP_SHARE, ratio);
    const costWashingMachine = applianceCost(WASHING_MACHINE_KWH_YEAR, WASHING_MACHINE_HP_SHARE, ratio);
    const costFridge = applianceCost(FRIDGE_KWH_YEAR, FRIDGE_HP_SHARE, ratio);
    const costElectronics = applianceCost(ELECTRONICS_KWH_YEAR, ELECTRONICS_HP_SHARE, ratio);
    const costAppliances = costDishwasher + costWashingMachine + costFridge;

    const costAutre = Math.max(
      0,
      costTotalReal - (costTesla + costHeating + costWaterHeater + costSub + costAppliances + costElectronics)
    );

    return {
      label: sem.label,
      shortLabel: sem.shortLabel,
      type: sem.type,
      costSub,
      costTesla,
      costHeating,
      costWaterHeater,
      costDishwasher,
      costWashingMachine,
      costFridge,
      costElectronics,
      costAppliances,
      costAutre,
      costTotalReal,
      solarGen,
      costSolar,
    };
  });
}

// ─── Number formatter ─────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmt(v: number | null | undefined, unit = " €"): string {
  if (v == null) return "-";
  return (
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) +
    unit
  );
}

function fmtSigned(v: number | null | undefined, sign: "+" | "-", unit = " €"): string {
  if (v == null) return "-";
  return (
    sign +
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) +
    unit
  );
}

function avgWinterAndSummer(
  winter: SemesterCostData[],
  summer: SemesterCostData[],
  key: keyof Pick<
    SemesterCostData,
    | "costSub"
    | "costHeating"
    | "costWaterHeater"
    | "costDishwasher"
    | "costWashingMachine"
    | "costFridge"
    | "costElectronics"
    | "costAppliances"
    | "costAutre"
    | "costTotalReal"
    | "solarGen"
  >
): { hiver: number; ete: number } {
  const hiver = winter.length ? winter.reduce((s, d) => s + d[key], 0) / winter.length : 0;
  const ete = summer.length ? summer.reduce((s, d) => s + d[key], 0) / summer.length : 0;
  return { hiver, ete };
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

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
          <span style={{ fontWeight: 700, color: "#fff" }}>{fmt(entry.value)}</span>
        </div>
      ))}
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Cost() {
  const { data, isLoading } = useQuery({
    queryKey: ["readings", "daily"],
    queryFn: () => api<DailyReading[]>("/readings/daily"),
  });

  const semesterData = buildSemesterData(data ?? []);

  // Split by group
  const octMarData = semesterData.filter((s) => s.type === "oct-mar");
  const avrSepData = semesterData.filter((s) => s.type === "avr-sep");

  // Summary stats — average HIVER (oct-mar) and average ETE (avr-sep), shown separately
  const avgAll = avgWinterAndSummer(octMarData, avrSepData, "costTotalReal");
  const avgHeating = avgWinterAndSummer(octMarData, avrSepData, "costHeating");
  const avgWaterHeater = avgWinterAndSummer(octMarData, avrSepData, "costWaterHeater");
  const avgAutre = avgWinterAndSummer(octMarData, avrSepData, "costAutre");
  const avgSub = avgWinterAndSummer(octMarData, avrSepData, "costSub");
  const avgDishwasher = avgWinterAndSummer(octMarData, avrSepData, "costDishwasher");
  const avgWashingMachine = avgWinterAndSummer(octMarData, avrSepData, "costWashingMachine");
  const avgFridge = avgWinterAndSummer(octMarData, avrSepData, "costFridge");
  const avgElectronics = avgWinterAndSummer(octMarData, avrSepData, "costElectronics");

  // Build chart data with group separator
  const emptySemester: SemesterCostData = {
    label: "",
    shortLabel: "   ",
    type: "oct-mar",
    costSub: 0,
    costTesla: 0,
    costHeating: 0,
    costWaterHeater: 0,
    costDishwasher: 0,
    costWashingMachine: 0,
    costFridge: 0,
    costElectronics: 0,
    costAppliances: 0,
    costAutre: 0,
    costTotalReal: 0,
    solarGen: 0,
    costSolar: 0,
    _separator: true,
  };
  const chartData: SemesterCostData[] = [
    ...octMarData,
    emptySemester,
    ...avrSepData,
  ];

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
              background: "linear-gradient(135deg, #10b981, #059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: "0 4px 20px rgba(16,185,129,0.45)",
              flexShrink: 0,
            }}
          >
            💵
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
              Analyse des Coûts
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
          label="Lave-vaisselle"
          valueEte={fmtSigned(avgDishwasher.ete, "-")}
          valueHiver={fmtSigned(avgDishwasher.hiver, "-")}
          sub="270 kWh/an (50% HP / 50% HC)"
          color="#38bdf8"
          icon="🍽️"
        />
        <StatCard
          label="Lave-linge"
          valueEte={fmtSigned(avgWashingMachine.ete, "-")}
          valueHiver={fmtSigned(avgWashingMachine.hiver, "-")}
          sub="110 kWh/an (75% HP / 25% HC)"
          color="#a78bfa"
          icon="🧺"
        />
        <StatCard
          label="Frigo"
          valueEte={fmtSigned(avgFridge.ete, "-")}
          valueHiver={fmtSigned(avgFridge.hiver, "-")}
          sub="200 kWh/an (66,66% HP / 33,33% HC)"
          color="#22d3ee"
          icon="🧊"
        />
        <StatCard
          label="Électroniques"
          valueEte={fmtSigned(avgElectronics.ete, "-")}
          valueHiver={fmtSigned(avgElectronics.hiver, "-")}
          sub="720 kWh/an (66,66% HP / 33,33% HC)"
          color="#fb923c"
          icon="📺"
        />
        <StatCard
          label="Coût Total"
          valueEte={fmtSigned(avgAll.ete, "-")}
          valueHiver={fmtSigned(avgAll.hiver, "-")}
          sub="Abonnement inclus"
          color="#f1f5f9"
          icon="💵"
        />
        <StatCard
          label="Chauffage PAC"
          valueEte={fmtSigned(avgHeating.ete, "-")}
          valueHiver={fmtSigned(avgHeating.hiver, "-")}
          sub="~2500 kWh/an (80% HC, 20% HP)"
          color="#ef4444"
          icon="🔥"
        />
        <StatCard
          label="Chauffe-eau"
          valueEte={fmtSigned(avgWaterHeater.ete, "-")}
          valueHiver={fmtSigned(avgWaterHeater.hiver, "-")}
          sub="~3200 kWh/an (100% HC)"
          color="#3b82f6"
          icon="💧"
        />
        <StatCard
          label="Autre"
          valueEte={fmtSigned(avgAutre.ete, "-")}
          valueHiver={fmtSigned(avgAutre.hiver, "-")}
          sub="Reste de la maison"
          color="#f59e0b"
          icon="🏠"
        />
        <StatCard
          label="Abonnement"
          valueEte={fmtSigned(avgSub.ete, "-")}
          valueHiver={fmtSigned(avgSub.hiver, "-")}
          sub="23.68 € / mois"
          color="#94a3b8"
          icon="🔌"
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
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Coûts semestriels
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
            Groupé par semestre · <span style={{ color: "#60a5fa" }}>■ Oct–Mar</span> &nbsp;
            <span style={{ color: "#f59e0b" }}>■ Avr–Sep</span>
          </p>
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
                  unit=" €"
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />

                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{ fill: "rgba(255,255,255,0.04)", radius: 6 }}
                />

                <Legend
                  formatter={(value) => (
                    <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>{value}</span>
                  )}
                  wrapperStyle={{ paddingTop: 12 }}
                />

                <Bar dataKey="costSub" name="Abonnement" stackId="a" fill="#64748b" />
                <Bar dataKey="costHeating" name="Chauffage" stackId="a" fill="#ef4444" />
                <Bar dataKey="costWaterHeater" name="Chauffe-eau" stackId="a" fill="#3b82f6" />
                <Bar dataKey="costTesla" name="Tesla" stackId="a" fill="#10b981" />
                <Bar dataKey="costAppliances" name="Électroménagers" stackId="a" fill="#38bdf8" />
                <Bar dataKey="costElectronics" name="Électroniques" stackId="a" fill="#fb923c" />
                <Bar dataKey="costAutre" name="Autre" stackId="a" fill="#a855f7" />
                <Bar dataKey="costSolar" name="Production Solaire" stackId="b" fill="#facc15" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
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
        <h3 style={{ fontSize: 13, fontWeight: 700, color: "#a5b4fc", margin: "0 0 8px" }}>
          ℹ️ Méthode de calcul
        </h3>
        <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.7, paddingBottom: 8 }}>
          <strong style={{ color: "#ef4444" }}>Chauffage PAC :</strong> Consommation de 2 500 kWh/an (répartie sur le semestre d'hiver), lissée sur le graphique, avec un calcul basé sur 80% en Heures Creuses (HC) et 20% en Heures Pleines (HP).
        </p>
        <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.7 }}>
          <strong style={{ color: "#3b82f6" }}>Chauffe-eau :</strong> Consommation totale de 3 200 kWh/an, avec une augmentation de +300 kWh affectée spécifiquement aux mois d'hiver (donc 1 750 kWh en hiver et 1 450 kWh en été).
        </p>
      </div>
    </div>
  );
}
