import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartSeries } from "../lib/readings";

const tooltipFormatter = (value: number | string) =>
  typeof value === "number" ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value) : value;

export default function SourceChart<T extends { date: string }>({
  title,
  data,
  series,
}: {
  title: string;
  data: T[];
  series: ChartSeries<T>[];
}) {
  const hasRightAxis = series.some((s) => s.axis === "right");

  return (
    <div
      style={{
        background: "linear-gradient(145deg, rgba(30,41,59,0.5), rgba(15,23,42,0.5))",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 16,
        padding: "24px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, color: "#f8fafc", marginBottom: 20 }}>{title}</h2>
      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
            {hasRightAxis && <YAxis yAxisId="right" orientation="right" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />}
            <Tooltip
              formatter={tooltipFormatter}
              contentStyle={{ backgroundColor: "#1e293b", borderColor: "rgba(255,255,255,0.1)", color: "#f8fafc", borderRadius: 8 }}
              itemStyle={{ color: "#e2e8f0" }}
            />
            <Legend wrapperStyle={{ paddingTop: 12 }} />
            {series.map((s) =>
              s.shape === "point" ? (
                <Scatter
                  key={String(s.key)}
                  yAxisId={s.axis === "right" ? "right" : "left"}
                  dataKey={s.key as string}
                  fill={s.color}
                  name={s.label}
                  shape={(props: { cx?: number; cy?: number }) => (
                    <circle cx={props.cx} cy={props.cy} r={3} fill={s.color} />
                  )}
                />
              ) : s.shape === "bar" ? (
                <Bar
                  key={String(s.key)}
                  yAxisId={s.axis === "right" ? "right" : "left"}
                  dataKey={s.key as string}
                  fill={s.color}
                  name={s.label}
                  stackId={s.stackId}
                />
              ) : (
                <Line
                  key={String(s.key)}
                  yAxisId={s.axis === "right" ? "right" : "left"}
                  type="monotone"
                  dataKey={s.key as string}
                  stroke={s.color}
                  strokeWidth={s.strokeWidth}
                  name={s.label}
                  dot={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
