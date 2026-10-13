import { Column, formatValue } from "../lib/readings";
import { DailyReading } from "../types";

export default function SourceTable({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: DailyReading[];
  columns: Column[];
}) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 20,
        padding: "24px 24px 20px",
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 48px rgba(0,0,0,0.35)",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", margin: "0 0 16px" }}>{title}</h2>
      <div style={{ maxHeight: 384, overflow: "auto", borderRadius: 12 }}>
        <table style={{ width: "max-content", minWidth: "100%", textAlign: "left", fontSize: 13, borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: "#1e293b", zIndex: 10 }}>
            <tr>
              <th
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.09)",
                  padding: "6px 10px",
                  fontWeight: 600,
                  color: "#94a3b8",
                  whiteSpace: "nowrap",
                }}
              >
                Date
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.09)",
                    padding: "6px 10px",
                    fontWeight: 600,
                    color: "#94a3b8",
                    whiteSpace: "nowrap",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "#38bdf8", marginBottom: 2 }}>
                      {col.key}
                    </span>
                    <span>{col.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    padding: "6px 10px",
                    whiteSpace: "nowrap",
                    color: "#cbd5e1",
                  }}
                >
                  {row.date}
                </td>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      padding: "6px 10px",
                      whiteSpace: "nowrap",
                      color: "#cbd5e1",
                    }}
                  >
                    {formatValue(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
