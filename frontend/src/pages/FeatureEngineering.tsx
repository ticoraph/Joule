import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { DailyReading } from "../types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from "recharts";

const CORR_KEYS = [
  "cli_amplitude_tmax_min",
  "cli_precip",
  "cli_tempmoy",
  "eco_kwh_per_daylighthour",
  "eco_actual_prod_minus_expected",
  "eco_ratio_solarperconsototal",
  "ene_conso_withouttesla",
  "ene_hc_byday",
  "ene_hp_byday",
  "ene_pmax",
  "ene_hcwithoutesla_to_hp_ratio",
  "sun_daylight_minute"
] as const;

function getPearsonCorrelation(x: number[], y: number[]) {
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  const n = x.length;
  if (n === 0) return 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denominator === 0) return 0;
  return numerator / denominator;
}

function getColorForCorrelation(value: number) {
  if (value > 0) {
    return `rgba(16, 185, 129, ${value * 0.9})`; // emerald-500
  } else if (value < 0) {
    return `rgba(239, 68, 68, ${Math.abs(value) * 0.9})`; // red-500
  }
  return "transparent";
}

type ShapPoint = { shapValue: number; featureValueNorm: number | null };
type ShapFeatureData = { feature: string; meanAbsShap: number; points: ShapPoint[] };

const SHAP_LOW_COLOR = { r: 0x3b, g: 0x82, b: 0xf6 }; // blue-500 (low feature value)
const SHAP_HIGH_COLOR = { r: 0xef, g: 0x44, b: 0x44 }; // red-500 (high feature value)
const SHAP_NA_COLOR = "#64748b"; // slate-500, for missing feature values

function shapPointColor(norm: number | null) {
  if (norm === null) return SHAP_NA_COLOR;
  const t = Math.min(1, Math.max(0, norm));
  const r = Math.round(SHAP_LOW_COLOR.r + (SHAP_HIGH_COLOR.r - SHAP_LOW_COLOR.r) * t);
  const g = Math.round(SHAP_LOW_COLOR.g + (SHAP_HIGH_COLOR.g - SHAP_LOW_COLOR.g) * t);
  const b = Math.round(SHAP_LOW_COLOR.b + (SHAP_HIGH_COLOR.b - SHAP_LOW_COLOR.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// Approximates a matplotlib/shap "beeswarm" summary plot: for each feature
// (row), every sample's SHAP value is plotted on the x axis and dodged
// vertically so overlapping points fan out instead of stacking, colored by
// the underlying (normalized) feature value.
function ShapSummaryPlot({ data }: { data: ShapFeatureData[] }) {
  const rowHeight = 34;
  const topPadding = 16;
  const bottomPadding = 30;
  const leftLabelWidth = 190;
  const rightPadding = 24;
  const width = 900;
  const pointRadius = 3;
  const height = data.length * rowHeight + topPadding + bottomPadding;

  const maxAbs = data.reduce((acc, row) => {
    const rowMax = row.points.reduce((m, p) => Math.max(m, Math.abs(p.shapValue)), 0);
    return Math.max(acc, rowMax);
  }, 0) || 1;

  const plotLeft = leftLabelWidth;
  const plotRight = width - rightPadding;
  const xScale = (v: number) => plotLeft + ((v + maxAbs) / (2 * maxAbs)) * (plotRight - plotLeft);

  const rows = data.map((row, rowIndex) => {
    const cy = topPadding + rowIndex * rowHeight + rowHeight / 2;
    const maxOffset = rowHeight / 2 - pointRadius - 1;

    const withX = row.points.map((p) => ({ ...p, x: xScale(p.shapValue) }));
    withX.sort((a, b) => a.x - b.x);

    const placed: { x: number; y: number }[] = [];
    const step = pointRadius * 2 + 0.5;
    const laid = withX.map((p) => {
      let offset = 0;
      let sign = 1;
      let k = 0;
      // Find the smallest dodge offset that doesn't collide with an
      // already-placed nearby point; give up and let it overlap once we
      // exceed the row band.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const candidate = offset;
        const collision = placed.some(
          (pl) => Math.abs(pl.x - p.x) < step && Math.abs(pl.y - candidate) < step
        );
        if (!collision || Math.abs(candidate) >= maxOffset) {
          offset = candidate;
          break;
        }
        k += 1;
        offset = sign * k * step;
        sign = -sign;
      }
      placed.push({ x: p.x, y: offset });
      return { ...p, y: cy + offset };
    });

    return { feature: row.feature, cy, points: laid };
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block", minWidth: 500 }}>
        {rows.map((row) => (
          <text
            key={`label-${row.feature}`}
            x={plotLeft - 12}
            y={row.cy}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={11}
            fill="#cbd5e1"
          >
            {row.feature}
          </text>
        ))}
        {rows.map((row, i) => (
          <line
            key={`sep-${row.feature}`}
            x1={plotLeft}
            x2={plotRight}
            y1={topPadding + i * rowHeight + rowHeight}
            y2={topPadding + i * rowHeight + rowHeight}
            stroke="rgba(255,255,255,0.05)"
          />
        ))}
        <line
          x1={xScale(0)}
          x2={xScale(0)}
          y1={topPadding}
          y2={topPadding + data.length * rowHeight}
          stroke="rgba(255,255,255,0.2)"
          strokeDasharray="3 3"
        />
        {rows.map((row) =>
          row.points.map((p, i) => (
            <circle
              key={`${row.feature}-${i}`}
              cx={p.x}
              cy={p.y}
              r={pointRadius}
              fill={shapPointColor(p.featureValueNorm)}
              fillOpacity={0.85}
            >
              <title>{`${row.feature}: SHAP ${p.shapValue.toFixed(4)}`}</title>
            </circle>
          ))
        )}
        <text
          x={xScale(0)}
          y={topPadding + data.length * rowHeight + 20}
          textAnchor="middle"
          fontSize={11}
          fill="#94a3b8"
        >
          Valeur SHAP (impact sur la prédiction)
        </text>
      </svg>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>Valeur de la variable :</span>
        <span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>Faible</span>
        <div
          style={{
            width: 120,
            height: 8,
            borderRadius: 4,
            background: "linear-gradient(90deg, #3b82f6, #ef4444)",
          }}
        />
        <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}>Élevée</span>
      </div>
    </div>
  );
}

export default function FeatureEngineering() {
  const [targetFeature, setTargetFeature] = useState<string>("ene_conso_withouttesla");

  const { data, isLoading, error } = useQuery({
    queryKey: ["dailyReadings"],
    queryFn: () => api<DailyReading[]>("/readings/daily"),
  });

  const { data: xgbData, isLoading: isLoadingXgb, error: errorXgb } = useQuery({
    queryKey: ["featureImportance", targetFeature],
    queryFn: () => api<{feature: string, importance: number}[]>(`/readings/feature-importance?target=${targetFeature}`),
  });

  const { data: shapData, isLoading: isLoadingShap, error: errorShap } = useQuery({
    queryKey: ["featureShap", targetFeature],
    queryFn: () => api<ShapFeatureData[]>(`/readings/feature-shap?target=${targetFeature}`),
  });

  if (isLoading) return <div style={{ color: "#fff", padding: 32 }}>Chargement...</div>;
  if (error) return <div style={{ color: "#ef4444", padding: 32 }}>Erreur : {String(error)}</div>;
  if (!data || data.length === 0) return <div style={{ color: "#fff", padding: 32 }}>Aucune donnée.</div>;

  const matrix: Record<string, Record<string, number>> = {};
  
  for (const key1 of CORR_KEYS) {
    matrix[key1] = {};
    for (const key2 of CORR_KEYS) {
      if (key1 === key2) {
        matrix[key1][key2] = 1;
        continue;
      }
      if (matrix[key2] && matrix[key2][key1] !== undefined) {
        matrix[key1][key2] = matrix[key2][key1];
        continue;
      }
      
      const x: number[] = [];
      const y: number[] = [];
      
      for (const row of data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as Record<string, any>;
        const actualKey1 = Object.keys(r).find(k => k.toLowerCase() === key1.toLowerCase()) || key1;
        const actualKey2 = Object.keys(r).find(k => k.toLowerCase() === key2.toLowerCase()) || key2;

        const val1 = r[actualKey1];
        const val2 = r[actualKey2];
        if (val1 !== null && val2 !== null && val1 !== undefined && val2 !== undefined) {
          x.push(Number(val1));
          y.push(Number(val2));
        }
      }
      
      matrix[key1][key2] = getPearsonCorrelation(x, y);
    }
  }

  const chartData = xgbData || [];
  const shapPlotData = shapData || [];

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
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
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
              boxShadow: "0 4px 12px rgba(59, 130, 246, 0.4)",
            }}
          >
            ⚙️
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.02em" }}>
            Feature Engineering
          </h1>
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, rgba(56,189,248,0.08), rgba(56,189,248,0.02))",
          border: "1px solid rgba(56,189,248,0.2)",
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 32,
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8", margin: "0 0 8px" }}>
          ℹ️ Nouvelles Features (Feature Engineering)
        </h3>
        <ul style={{ fontSize: 12, color: "#94a3b8", margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
          <li>
            <strong style={{ color: "#f8fafc" }}>cli_amplitude_tmax_min</strong> : Amplitude Thermique (Différence de température entre le maximum et le minimum de la journée).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>cli_precip</strong> : Précipitations (cumul journalier de précipitations, en mm, mesuré à la station météo de Chambéry).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>cli_tempmoy</strong> : Température Moyenne (température moyenne journalière, en °C).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>eco_kwh_per_daylighthour</strong> : Rendement (Production solaire réelle en kWh par heure d'ensoleillement théorique).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>eco_actual_prod_minus_expected</strong> : Résidu de performance (Différence entre la production solaire réelle et la production attendue selon une régression linéaire sur la durée d'ensoleillement).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>eco_ratio_solarperconsototal</strong> : Ratio Autoconsommation Solaire (Part de la consommation domestique couverte par le solaire, hors charge Tesla).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>ene_conso_withouttesla</strong> : Consommation hors Tesla (Consommation totale Enedis moins la charge Tesla à domicile).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>ene_hc_byday</strong> : Consommation Heures Creuses (kWh consommés dans la journée en heures creuses, dérivé de l'index cumulé Enedis).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>ene_hp_byday</strong> : Consommation Heures Pleines (kWh consommés dans la journée en heures pleines, dérivé de l'index cumulé Enedis).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>ene_pmax</strong> : Puissance Maximale (puissance de pointe atteinte dans la journée, en kVA, relevée par le compteur Enedis).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>ene_hcwithoutesla_to_hp_ratio</strong> : Ratio HC Net / HP (Ratio de la consommation en heures creuses nette de la charge Tesla par rapport à la consommation en heures pleines).
          </li>
          <li>
            <strong style={{ color: "#f8fafc" }}>sun_daylight_minute</strong> : Durée d'Ensoleillement (durée théorique du jour, en minutes, entre le lever et le coucher du soleil).
          </li>
        </ul>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: "0 0 8px" }}>
          Matrice de corrélation temporelle des métriques
        </h2>
        <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, lineHeight: 1.6 }}>
          Cette matrice affiche le <strong>Coefficient de Corrélation de Pearson</strong> entre chaque paire de variables. 
          Il permet de mesurer la force de la relation linéaire (de -1 à 1) : 
          <span style={{ color: "#10b981", fontWeight: 600 }}> +1</span> indique une corrélation positive parfaite (les deux variables augmentent ensemble), 
          <span style={{ color: "#ef4444", fontWeight: 600 }}> -1</span> indique une corrélation négative parfaite (quand l'une monte, l'autre descend), et 
          <strong> 0</strong> signifie qu'il n'y a aucune relation linéaire (indépendantes). Le calcul est effectué sur tout l'historique disponible.
        </p>
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16,
          padding: "20px",
          backdropFilter: "blur(12px)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
          overflowX: "auto",
          marginBottom: 40,
        }}
      >
        <table style={{ borderCollapse: "collapse", width: "max-content", color: "#f8fafc", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)", textAlign: "left" }}>Variables</th>
              {CORR_KEYS.map(k => (
                <th key={k} style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.1)", writingMode: "vertical-rl", transform: "rotate(180deg)", textAlign: "left", fontWeight: 600 }}>
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CORR_KEYS.map((key1, i) => (
              <tr key={key1} style={{ borderBottom: i === CORR_KEYS.length - 1 ? "none" : "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600, borderRight: "1px solid rgba(255,255,255,0.1)", whiteSpace: "nowrap" }}>
                  {key1}
                </td>
                {CORR_KEYS.map(key2 => {
                  const val = matrix[key1][key2];
                  const bg = getColorForCorrelation(val);
                  return (
                    <td key={key2} style={{ width: 40, height: 40, textAlign: "center", backgroundColor: bg, border: "1px solid rgba(255,255,255,0.05)" }} title={`${key1} / ${key2}: ${val.toFixed(3)}`}>
                      {val.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: "0 0 8px" }}>
              Feature Importance
            </h2>
            <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, lineHeight: 1.6 }}>
              Ce graphique utilise un modèle <strong>XGBoost</strong> (côté serveur) pour déterminer 
              l'importance (Feature Importance) de chaque variable dans la prédiction de la variable cible sélectionnée.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>
              Variable cible :
            </label>
            <select
              value={targetFeature}
              onChange={(e) => setTargetFeature(e.target.value)}
              style={{
                background: "rgba(15, 23, 42, 0.6)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: "8px 12px",
                color: "#f8fafc",
                fontSize: 13,
                outline: "none",
                cursor: "pointer",
              }}
            >
              {CORR_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 16,
            padding: "24px 20px 20px",
            height: 400,
            position: "relative",
          }}
        >
          {isLoadingXgb && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15, 23, 42, 0.7)", zIndex: 10, borderRadius: 16 }}>
              <span style={{ color: "#38bdf8", fontWeight: 600 }}>Entraînement XGBoost en cours...</span>
            </div>
          )}
          {errorXgb && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15, 23, 42, 0.7)", zIndex: 10, borderRadius: 16 }}>
              <span style={{ color: "#ef4444", fontWeight: 600 }}>Erreur lors de la modélisation.</span>
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 30, left: 100, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={true} vertical={false} />
              <XAxis 
                type="number" 
                domain={[0, 'auto']} 
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickLine={{ stroke: "rgba(255,255,255,0.1)" }}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              />
              <YAxis 
                type="category" 
                dataKey="feature" 
                tick={{ fill: "#cbd5e1", fontSize: 11 }}
                width={140}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              />
              <Tooltip 
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                contentStyle={{ 
                  backgroundColor: "rgba(15, 23, 42, 0.9)", 
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "#f8fafc"
                }}
                itemStyle={{ color: "#38bdf8" }}
                formatter={(value: number) => [
                  value.toFixed(4), 
                  'Importance (XGBoost)'
                ]}
              />
              <Bar dataKey="importance" radius={[0, 4, 4, 0]} barSize={20}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill="#38bdf8"
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: "0 0 8px" }}>
            Importance SHAP
          </h2>
          <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, lineHeight: 1.6 }}>
            Ce graphique de type <strong>SHAP summary plot</strong> affiche, pour chaque variable, la valeur
            SHAP de chaque jour de l'historique (contributions additives calculées nativement par le modèle
            <strong> XGBoost</strong> pour la variable cible sélectionnée ci-dessus). Chaque point est un jour :
            sa position horizontale indique son impact (positif ou négatif) sur la prédiction, et sa couleur
            indique si la variable avait une valeur faible (bleu) ou élevée (rouge) ce jour-là. Les variables
            sont triées de la plus (en haut) à la moins (en bas) influente.
          </p>
        </div>

        <div
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 16,
            padding: "24px 20px 20px",
            position: "relative",
          }}
        >
          {isLoadingShap && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15, 23, 42, 0.7)", zIndex: 10, borderRadius: 16 }}>
              <span style={{ color: "#a78bfa", fontWeight: 600 }}>Calcul des valeurs SHAP en cours...</span>
            </div>
          )}
          {errorShap && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15, 23, 42, 0.7)", zIndex: 10, borderRadius: 16 }}>
              <span style={{ color: "#ef4444", fontWeight: 600 }}>Erreur lors du calcul SHAP.</span>
            </div>
          )}
          {!isLoadingShap && !errorShap && shapPlotData.length > 0 && (
            <ShapSummaryPlot data={shapPlotData} />
          )}
        </div>
      </div>
    </div>
  );
}
