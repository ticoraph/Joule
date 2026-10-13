import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { api } from '../api/client';
import { ModelPrediction, Forecast } from '../types';

const MODEL_COLORS: Record<string, string> = {
  Chronos2: "#38bdf8",
  TimesFM: "#f472b6",
  XGBoost: "#facc15",
  Average: "#4ade80",
  Prophet: "#a855f7",
};

type ModelComparisonRow = {
  date: string;
  actual: number | null;
  [key: string]: string | number | null;
};

function mergeModelPredictions(models: ModelPrediction[]): ModelComparisonRow[] {
  const rows = new Map<string, ModelComparisonRow>();

  for (const model of models) {
    for (const p of model.points) {
      const row = rows.get(p.date) ?? { date: p.date, actual: null };
      if (row.actual == null) row.actual = p.actual;
      row[`predicted_${model.model}`] = p.predicted;
      rows.set(p.date, row);
    }
  }

  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function formatMetric(value: number | null | undefined, unit = "") {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}${unit}`;
}

type ForecastChartRow = {
  date: string;
  predicted: number | null;
  p10: number | null;
  band: number | null;
  actual: number | null;
};

function prepareForecastChartData(forecast: Forecast | undefined): ForecastChartRow[] {
  if (!forecast) return [];
  return forecast.points.map((p) => ({
    date: p.date,
    predicted: p.predicted,
    p10: p.p10,
    band: p.p10 != null && p.p90 != null ? p.p90 - p.p10 : null,
    actual: p.actual,
  }));
}

const FORECAST_MODEL_LABELS: Record<string, string> = {
  chronos2: "Chronos2",
  timesfm: "TimesFM",
  xgboost: "XGBoost",
};

function describeForecastFile(file: string | null | undefined) {
  if (!file) return null;
  const m = file.match(/^prediction_prod_(chronos2|timesfm|xgboost)_(\d{8})_(\d{8})\.csv$/);
  if (!m) return null;
  const [, slug, startStr, endStr] = m;
  const fmt = (s: string) =>
    new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`).toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
  return { modelLabel: FORECAST_MODEL_LABELS[slug] ?? slug, start: fmt(startStr), end: fmt(endStr) };
}

export default function Predictions() {
  const { data: modelPredictions, isLoading: isLoadingModelPredictions } = useQuery({
    queryKey: ["predictions", "models"],
    queryFn: () => api<ModelPrediction[]>("/predictions/models"),
  });

  const { data: forecast, isLoading: isLoadingForecast } = useQuery({
    queryKey: ["predictions", "forecast"],
    queryFn: () => api<Forecast>("/predictions/forecast"),
  });

  const modelComparisonData = mergeModelPredictions(modelPredictions ?? []);

  const allModels = modelPredictions ?? [];

  const forecastChartData = prepareForecastChartData(forecast);
  // pct_bias is (predicted - actual) / actual; flip sign so + means real > prévision
  const forecastPctDeviation =
    forecast?.metrics?.pct_bias != null ? -forecast.metrics.pct_bias : null;
  const forecastMae = forecast?.metrics?.mape ?? null;
  const forecastFileInfo = describeForecastFile(forecast?.file);

  const bestModel = allModels
    .filter((m) => m.metrics)
    .sort((a, b) => (a.metrics!.rmse ?? Infinity) - (b.metrics!.rmse ?? Infinity))[0];

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
              background: "linear-gradient(135deg, #6366f1, #4338ca)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              boxShadow: "0 4px 20px rgba(99,102,241,0.45)",
              flexShrink: 0,
            }}
          >
            🔮
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
              Prédictions
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0, marginTop: 2 }}>
              Moyennes historiques par jour de l'année
            </p>
          </div>
        </div>
      </div>

      {/* ── Variables card ─────────────────────────────────────────────────── */}
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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: "0 0 8px" }}>
          Variables Utilisées pour les Prédictions
        </h2>
        <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 16px" }}>
          Les modèles de prédiction se basent sur les colonnes suivantes :
        </p>
        <ul style={{ listStyle: "disc", paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["cli_amplitude_tmax_min", "L'amplitude thermique quotidienne (différence entre la température maximale et minimale)."],
            ["cli_precip", "La quantité de précipitations quotidiennes."],
            ["cli_tempmoy", "La température moyenne sur la journée."],
            ["eco_kwh_per_daylighthour", "Le rendement énergétique par heure d'ensoleillement (kWh/h)."],
            ["eco_actual_prod_minus_expected", "Les résidus de performance par rapport à la tendance."],
            ["ene_conso", "La consommation totale d'énergie."],
            ["ene_hc_byday", "La consommation d'énergie en heures creuses par jour."],
            ["ene_hp_byday", "La consommation d'énergie en heures pleines par jour."],
            ["ene_pmax", "La puissance maximale atteinte."],
            ["ene_hcwithoutesla_to_hp_ratio", "Le ratio entre la consommation nette en heures creuses et en heures pleines."],
            ["tes_homekwh", "La consommation électrique spécifique de la maison (kWh)."],
          ].map(([key, desc]) => (
            <li key={key} style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              <strong style={{ color: "#cbd5e1" }}>{key}</strong> : {desc}
            </li>
          ))}
        </ul>
      </div>

      {/* ── Model comparison card ─────────────────────────────────────────── */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 20,
          padding: "28px 28px 20px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 48px rgba(0,0,0,0.35)",
          marginTop: 24,
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Comparaison des Modèles de Prévision
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
            Consommation électrique prédite par Chronos2, TimesFM, XGBoost et la Moyenne historique,
            comparée à la consommation réelle.
          </p>
        </div>

        {isLoadingModelPredictions ? (
          <div
            style={{
              height: 400,
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
          <>
            <div style={{ height: 400, marginBottom: 24 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={modelComparisonData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                    tickLine={false}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getDate()}/${date.getMonth() + 1}`;
                    }}
                    minTickGap={30}
                  />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(15,23,42,0.95)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12,
                      color: "#fff",
                    }}
                    labelFormatter={(label) => new Date(label).toLocaleDateString('fr-FR')}
                  />
                  <Legend
                    formatter={(value) => (
                      <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>{value}</span>
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Conso Réelle (kWh)"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    dot={false}
                  />
                  {allModels.map((m) => (
                    <Line
                      key={m.model}
                      type="monotone"
                      dataKey={`predicted_${m.model}`}
                      name={m.model === "Average" ? "Moyenne historique" : `${m.model} (prévision)`}
                      stroke={MODEL_COLORS[m.model] ?? "#8884d8"}
                      strokeDasharray="4 3"
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 16,
              }}
            >
              {allModels.map((m) => {
                const isBest = bestModel?.model === m.model;
                return (
                  <div
                    key={m.model}
                    style={{
                      border: isBest ? "1px solid rgba(74,222,128,0.5)" : "1px solid rgba(255,255,255,0.09)",
                      background: isBest ? "rgba(74,222,128,0.07)" : "rgba(255,255,255,0.03)",
                      borderRadius: 14,
                      padding: "16px 18px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: MODEL_COLORS[m.model] ?? "#8884d8",
                          display: "inline-block",
                        }}
                      />
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{m.model}</span>
                      {isBest && (
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#4ade80",
                            background: "rgba(74,222,128,0.12)",
                            padding: "2px 8px",
                            borderRadius: 999,
                          }}
                        >
                          MEILLEUR (RMSE)
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                        <span style={{ color: "#64748b" }}>MAE</span>
                        <span style={{ color: "#cbd5e1", fontWeight: 600 }}>
                          {formatMetric(m.metrics?.mae, " kWh")}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                        <span style={{ color: "#64748b" }}>RMSE</span>
                        <span style={{ color: "#cbd5e1", fontWeight: 600 }}>
                          {formatMetric(m.metrics?.rmse, " kWh")}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                        <span style={{ color: "#64748b" }}>MAPE</span>
                        <span style={{ color: "#cbd5e1", fontWeight: 600 }}>
                          {formatMetric(m.metrics?.mape, " %")}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                        <span style={{ color: "#64748b" }}>Biais</span>
                        <span style={{ color: "#cbd5e1", fontWeight: 600 }}>
                          {formatMetric(m.metrics?.bias, " kWh")}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginTop: 2 }}>
                        <span style={{ color: "#475569" }}>Jours comparés</span>
                        <span style={{ color: "#64748b" }}>{m.metrics?.n ?? 0}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <p style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: "#cbd5e1" }}>MAE</strong> (erreur absolue moyenne) : écart moyen, en
                kWh, entre la prédiction et la valeur réelle, sans tenir compte du signe. <strong style={{ color: "#4ade80" }}>Plus bas = mieux</strong>,
                et se lit directement en kWh d'erreur par jour.
              </p>
              <p style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: "#cbd5e1" }}>RMSE</strong> (racine de l'erreur quadratique moyenne) :
                comme le MAE mais pénalise davantage les grosses erreurs ponctuelles (au carré avant la moyenne).
                <strong style={{ color: "#4ade80" }}> Plus bas = mieux</strong>. Un RMSE nettement supérieur au
                MAE signale quelques jours très mal prédits plutôt qu'une erreur régulière.
              </p>
              <p style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: "#cbd5e1" }}>MAPE</strong> (erreur absolue moyenne en pourcentage) : le
                MAE exprimé en % de la valeur réelle, ce qui permet de comparer la précision indépendamment de
                l'échelle. <strong style={{ color: "#4ade80" }}>Plus bas = mieux</strong> (0 % = prédiction parfaite).
              </p>
              <p style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: "#cbd5e1" }}>Biais</strong> : erreur moyenne <em>avec</em> son signe.
                <strong style={{ color: "#4ade80" }}> Proche de 0 = mieux</strong> ; un biais positif signifie que
                le modèle surestime la consommation en moyenne, un biais négatif qu'il la sous-estime.
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── Real-world forecast card (Jul–Sep 2026) ──────────────────────────── */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 20,
          padding: "28px 28px 20px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 48px rgba(0,0,0,0.35)",
          marginTop: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
              Prévision Réelle
              {forecastFileInfo ? ` — ${forecastFileInfo.start} à ${forecastFileInfo.end}` : ""}
            </h2>
            <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
              Prévision de consommation produite par {forecastFileInfo?.modelLabel ?? "un modèle"} (avec
              intervalle P10–P90), non recalculée a posteriori.
              {forecast?.file ? ` Fichier : ${forecast.file}` : ""}
            </p>
          </div>

          {!isLoadingForecast && (
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.09)",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 14,
                padding: "12px 18px",
                minWidth: 200,
              }}
            >
              {forecast?.metrics ? (
                <>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                    Réel vs prévision ({forecast.metrics.n} jour{forecast.metrics.n > 1 ? "s" : ""} comparé
                    {forecast.metrics.n > 1 ? "s" : ""})
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color:
                        forecastPctDeviation == null
                          ? "#f1f5f9"
                          : Math.abs(forecastPctDeviation) < 5
                          ? "#4ade80"
                          : Math.abs(forecastPctDeviation) < 15
                          ? "#facc15"
                          : "#f87171",
                    }}
                  >
                    {forecastPctDeviation == null
                      ? "—"
                      : `${forecastPctDeviation > 0 ? "+" : ""}${forecastPctDeviation.toFixed(1)}%`}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
                    {forecastPctDeviation == null
                      ? null
                      : forecastPctDeviation > 0
                      ? "La consommation réelle dépasse la prévision"
                      : "La consommation réelle est sous la prévision"}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                    MAPE : {formatMetric(forecastMae, " %")}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: "#64748b" }}>
                  Pas encore de données réelles pour comparaison.
                </div>
              )}
            </div>
          )}
        </div>

        {isLoadingForecast ? (
          <div
            style={{
              height: 400,
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
          <div style={{ height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={forecastChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                  tickLine={false}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getDate()}/${date.getMonth() + 1}`;
                  }}
                  minTickGap={30}
                />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,23,42,0.95)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 12,
                    color: "#fff",
                  }}
                  labelFormatter={(label) => new Date(label).toLocaleDateString('fr-FR')}
                  formatter={(value: number | string, name: string) =>
                    name === "predicted"
                      ? [`${Number(value).toFixed(2)} kWh`, "Prévision (Chronos2)"]
                      : name === "actual"
                      ? [`${Number(value).toFixed(2)} kWh`, "Conso Réelle"]
                      : [value, name]
                  }
                />
                <Legend
                  formatter={(value) => (
                    <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>{value}</span>
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="p10"
                  stackId="range"
                  name="p10"
                  stroke="none"
                  fill="transparent"
                  legendType="none"
                  tooltipType="none"
                />
                <Area
                  type="monotone"
                  dataKey="band"
                  stackId="range"
                  name="Intervalle P10–P90"
                  stroke="none"
                  fill="rgba(56,189,248,0.15)"
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  name="Prévision (Chronos2)"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Conso Réelle"
                  stroke="#94a3b8"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
