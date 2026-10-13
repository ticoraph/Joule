import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface TableDump {
  name: string;
  columns: string[];
  rows: any[];
}

export default function Database() {
  const { data: tables, isLoading } = useQuery({
    queryKey: ["database", "dump"],
    queryFn: () => api<TableDump[]>("/database/dump"),
  });

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
            🗄️
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
              Tables BDD
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0, marginTop: 2 }}>
              Contenu brut des tables de la base de données
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
          {tables?.map((table) => (
            <div
              key={table.name}
              style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 20,
                padding: "24px 24px 20px",
                backdropFilter: "blur(16px)",
                boxShadow: "0 8px 48px rgba(0,0,0,0.35)",
              }}
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", margin: "0 0 16px" }}>
                {table.name}
              </h2>
              <div style={{ maxHeight: 384, overflow: "auto", borderRadius: 12 }}>
                <table style={{ width: "max-content", minWidth: "100%", textAlign: "left", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#1e293b", zIndex: 10 }}>
                    <tr>
                      {table.columns.map((col) => (
                        <th
                          key={col}
                          style={{
                            borderBottom: "1px solid rgba(255,255,255,0.09)",
                            padding: "6px 10px",
                            fontWeight: 600,
                            color: "#94a3b8",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, idx) => (
                      <tr key={idx}>
                        {table.columns.map((col) => (
                          <td
                            key={col}
                            style={{
                              borderBottom: "1px solid rgba(255,255,255,0.06)",
                              padding: "6px 10px",
                              whiteSpace: "nowrap",
                              color: "#cbd5e1",
                            }}
                          >
                            {row[col] === null || row[col] === undefined
                              ? "-"
                              : typeof row[col] === "number"
                              ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(row[col])
                              : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
