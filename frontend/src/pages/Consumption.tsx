import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import SourceTable from "../components/SourceTable";
import { AQR_COLUMNS, CLI_COLUMNS, EAU_COLUMNS, ECO_COLUMNS, ENE_COLUMNS, TES_COLUMNS } from "../lib/readings";
import { DailyReading } from "../types";

export default function Consumption() {
  const { data, isLoading } = useQuery({
    queryKey: ["readings", "daily"],
    queryFn: () => api<DailyReading[]>("/readings/daily"),
  });

  const rowsDesc = [...(data ?? [])]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 365);

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
            🧾
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
              Données Fournisseurs
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0, marginTop: 2 }}>
              Relevés quotidiens bruts par source · 365 derniers jours
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div
          style={{
            height: 200,
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
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <SourceTable title="ENE_ - Enedis (conso, index, pmax)" rows={rowsDesc} columns={ENE_COLUMNS} />
          <SourceTable title="ECO_ - EcoFlow (solaire, maison, batterie)" rows={rowsDesc} columns={ECO_COLUMNS} />
          <SourceTable title="CLI_ - Infoclimat (température, précipitations)" rows={rowsDesc} columns={CLI_COLUMNS} />
          <SourceTable title="EAU_ - Eau du Grand Chambery (consommation)" rows={rowsDesc} columns={EAU_COLUMNS} />
          <SourceTable title="TES_ - Tesla (charge, coût)" rows={rowsDesc} columns={TES_COLUMNS} />
          <SourceTable title="AQR_ - Aqara (temperatures, prises)" rows={rowsDesc} columns={AQR_COLUMNS} />
        </div>
      )}
    </div>
  );
}
