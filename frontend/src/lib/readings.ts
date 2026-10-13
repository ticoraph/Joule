import { DailyReading } from "../types";

export interface Column {
  key: keyof DailyReading;
  label: string;
}

export interface ChartSeries<T> {
  key: keyof T;
  label: string;
  color: string;
  axis?: "left" | "right";
  shape?: "line" | "point" | "bar";
  stackId?: string;
  strokeWidth?: number;
}

export const CHART_COLORS = [
  "#4f46e5",
  "#f97316",
  "#16a34a",
  "#0ea5e9",
  "#dc2626",
  "#9333ea",
  "#ca8a04",
  "#0d9488",
  "#db2777",
  "#475569",
];

export function trimToDataRange<T extends { date: string }>(rows: T[], keys: (keyof T)[]): T[] {
  const hasData = (row: T) => keys.some((k) => row[k] !== null && row[k] !== undefined);
  const first = rows.findIndex(hasData);
  if (first === -1) return [];
  const last = rows.length - 1 - [...rows].reverse().findIndex(hasData);
  return rows.slice(first, last + 1);
}

export interface MonthlyChartPoint {
  date: string;
  [key: string]: number | string;
}

export type AggregateMode = "sum" | "avg";

function groupChartData<T extends { date: string }>(
  rows: T[],
  keys: (keyof T)[],
  groupKey: (date: string) => string,
  modes: Partial<Record<keyof T, AggregateMode>>,
): MonthlyChartPoint[] {
  const sums = new Map<string, MonthlyChartPoint>();
  const counts = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const group = groupKey(row.date);
    const entry = sums.get(group) ?? { date: group };
    const countEntry = counts.get(group) ?? {};
    for (const k of keys) {
      const value = row[k];
      if (typeof value === "number") {
        const field = k as string;
        entry[field] = (typeof entry[field] === "number" ? entry[field] : 0) + value;
        countEntry[field] = (countEntry[field] ?? 0) + 1;
      }
    }
    sums.set(group, entry);
    counts.set(group, countEntry);
  }
  for (const [group, entry] of sums) {
    const countEntry = counts.get(group) ?? {};
    for (const k of keys) {
      if (modes[k] !== "avg") continue;
      const field = k as string;
      const count = countEntry[field];
      if (count) entry[field] = (entry[field] as number) / count;
    }
  }
  return Array.from(sums.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function toMonthlyChartData<T extends { date: string }>(
  rows: T[],
  keys: (keyof T)[],
  modes: Partial<Record<keyof T, AggregateMode>> = {},
): MonthlyChartPoint[] {
  return groupChartData(rows, keys, (date) => date.slice(0, 7), modes);
}

function isoWeekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dayIndex = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayIndex);
  return d.toISOString().slice(0, 10);
}

export function toWeeklyChartData<T extends { date: string }>(
  rows: T[],
  keys: (keyof T)[],
  modes: Partial<Record<keyof T, AggregateMode>> = {},
): MonthlyChartPoint[] {
  return groupChartData(rows, keys, isoWeekStart, modes);
}

export function toDailyChartData<T extends { date: string }>(rows: T[], keys: (keyof T)[]): MonthlyChartPoint[] {
  return rows.map((row) => {
    const point: MonthlyChartPoint = { date: row.date };
    for (const k of keys) {
      const value = row[k];
      if (typeof value === "number") point[k as string] = value;
    }
    return point;
  });
}

export function formatValue(value: DailyReading[keyof DailyReading]): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") {
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
  }
  return String(value);
}

export const ENE_COLUMNS: Column[] = [
  { key: "ene_conso", label: "Conso (kWh)" },
  { key: "ene_index_total", label: "Index total" },
  { key: "ene_index_hp", label: "Index HP" },
  { key: "ene_index_hc", label: "Index HC" },
  { key: "ene_pmax", label: "PMax (kW)" },
  { key: "ene_pmax_hour", label: "PMax heure" },
];

export const ECO_COLUMNS: Column[] = [
  { key: "eco_solartotalgeneration", label: "Solar total (kWh)" },
  { key: "eco_solartobattery", label: "Solar -> batterie (kWh)" },
  { key: "eco_solartohome", label: "Solar -> maison (kWh)" },
  { key: "eco_hometoloads", label: "Maison -> charges (kWh)" },
  { key: "eco_batterytotaldischarging", label: "Batterie decharge (kWh)" },
  { key: "eco_batterydiff", label: "Batterie diff (kWh)" },
];

export const CLI_COLUMNS: Column[] = [
  { key: "cli_tempmax", label: "Temp max (°C)" },
  { key: "cli_tempmin", label: "Temp min (°C)" },
  { key: "cli_tempmoy", label: "Temp moy (°C)" },
  { key: "cli_precip", label: "Precip (mm)" },
];

export const EAU_COLUMNS: Column[] = [{ key: "eau_conso", label: "Conso (m³)" }];

export const TES_COLUMNS: Column[] = [
  { key: "tes_totalkwh", label: "Total (kWh)" },
  { key: "tes_homekwh", label: "Maison (kWh)" },
  { key: "tes_superchargerkwh", label: "Supercharger (kWh)" },
  { key: "tes_workkwh", label: "Travail (kWh)" },
  { key: "tes_otherkwh", label: "Autre (kWh)" },
  { key: "tes_totalcosteur", label: "Cout total (€)" },
];

export const AQR_COLUMNS: Column[] = [
  { key: "aqr_tempetage", label: "Temp etage (°C)" },
  { key: "aqr_tempfreezer", label: "Temp freezer (°C)" },
  { key: "aqr_tempcongel", label: "Temp congel (°C)" },
  { key: "aqr_tempsalon", label: "Temp salon (°C)" },
  { key: "aqr_tempabrijardin", label: "Temp abri jardin (°C)" },
  { key: "aqr_tempchaufferie", label: "Temp chaufferie (°C)" },
  { key: "aqr_tempthermostat", label: "Temp thermostat (°C)" },
  { key: "aqr_priseordinateur_kwh", label: "Prise ordinateur (kWh)" },
  { key: "aqr_prisecafetiere_kwh", label: "Prise cafetiere (kWh)" },
  { key: "aqr_prisefrigo_kwh", label: "Prise frigo (kWh)" },
  { key: "aqr_prisesalon_kwh", label: "Prise salon (kWh)" },
  { key: "aqr_prisealarme_kwh", label: "Prise alarme (kWh)" },
  { key: "aqr_prisemac_kwh", label: "Prise mac (kWh)" },
];

export interface EneChartPoint {
  date: string;
  ene_conso_kwh: number | null;
  ene_hp_kwh: number | null;
  ene_hc_hors_tesla_kwh: number | null;
  ene_hc_tesla_kwh: number | null;
  ene_solar_kwh: number | null;
  ene_pmax_kw: number | null;
}

export function toEneChartData(rows: DailyReading[]): EneChartPoint[] {
  return rows.map((row) => {
    const tesla = row.tes_homekwh ?? 0;
    return {
      date: row.date,
      ene_conso_kwh: row.ene_conso ?? null,
      ene_hp_kwh: row.ene_hp_byday ?? null,
      ene_hc_hors_tesla_kwh: row.ene_hc_byday != null ? row.ene_hc_byday - tesla : null,
      ene_hc_tesla_kwh: row.ene_hc_byday != null ? tesla : null,
      ene_solar_kwh: row.eco_solartohome ?? null,
      ene_pmax_kw: row.ene_pmax ?? null,
    };
  });
}

export const ENE_SERIES: ChartSeries<MonthlyChartPoint>[] = [
  { key: "ene_solar_kwh", label: "Solaire -> maison (kWh)", color: CHART_COLORS[6], shape: "bar", stackId: "ene" },
  {
    key: "ene_hc_hors_tesla_kwh",
    label: "Conso HC hors Tesla (kWh)",
    color: CHART_COLORS[3],
    shape: "bar",
    stackId: "ene",
  },
  { key: "ene_hc_tesla_kwh", label: "Conso HC Tesla (kWh)", color: CHART_COLORS[5], shape: "bar", stackId: "ene" },
  { key: "ene_hp_kwh", label: "Conso HP (kWh)", color: CHART_COLORS[2], shape: "bar", stackId: "ene" },
];

export const ECO_SERIES: ChartSeries<MonthlyChartPoint>[] = [
  { key: "eco_solartohome", label: "Solar -> maison (kWh)", color: CHART_COLORS[2], shape: "bar", stackId: "eco" },
  { key: "eco_solartobattery", label: "Solar -> batterie (kWh)", color: CHART_COLORS[0], shape: "bar", stackId: "eco" },
  {
    key: "eco_batterytotaldischarging",
    label: "Batterie decharge (kWh)",
    color: CHART_COLORS[4],
    shape: "bar",
    stackId: "eco",
  },
];

export const CLI_SERIES: ChartSeries<MonthlyChartPoint>[] = [
  { key: "cli_tempmax", label: "Temp max (°C)", color: CHART_COLORS[1] },
  { key: "cli_tempmin", label: "Temp min (°C)", color: CHART_COLORS[3] },
  { key: "cli_tempmoy", label: "Temp moy (°C)", color: CHART_COLORS[0] },
  { key: "cli_precip", label: "Precip (mm)", color: CHART_COLORS[2], axis: "right" },
];

export const EAU_SERIES: ChartSeries<MonthlyChartPoint>[] = EAU_COLUMNS.map((col, i) => ({
  key: col.key as string,
  label: col.label,
  color: CHART_COLORS[i % CHART_COLORS.length],
  shape: "bar",
}));

export const TES_SERIES: ChartSeries<MonthlyChartPoint>[] = [
  { key: "tes_homekwh", label: "Maison (kWh)", color: CHART_COLORS[2], shape: "bar", stackId: "tes" },
  { key: "tes_superchargerkwh", label: "Supercharger (kWh)", color: CHART_COLORS[0], shape: "bar", stackId: "tes" },
  { key: "tes_otherkwh", label: "Autre (kWh)", color: CHART_COLORS[4], shape: "bar", stackId: "tes" },
];

const AQR_TEMP_KEYS = [
  "aqr_tempetage",
  "aqr_tempfreezer",
  "aqr_tempcongel",
  "aqr_tempsalon",
  "aqr_tempabrijardin",
  "aqr_tempchaufferie",
  "aqr_tempthermostat",
] as const;

const AQR_PRISE_KEYS = [
  "aqr_priseordinateur_kwh",
  "aqr_prisecafetiere_kwh",
  "aqr_prisefrigo_kwh",
  "aqr_prisesalon_kwh",
  "aqr_prisealarme_kwh",
  "aqr_prisemac_kwh",
] as const;

export const AQR_KEYS: (keyof DailyReading)[] = [...AQR_TEMP_KEYS, ...AQR_PRISE_KEYS];
export const AQR_TEMP_CHART_KEYS: (keyof DailyReading)[] = [...AQR_TEMP_KEYS];
export const AQR_PRISE_CHART_KEYS: (keyof DailyReading)[] = [...AQR_PRISE_KEYS];

export const AQR_TEMP_SERIES: ChartSeries<MonthlyChartPoint>[] = AQR_TEMP_KEYS.map((key, i) => ({
  key,
  label: AQR_COLUMNS.find((c) => c.key === key)!.label,
  color: CHART_COLORS[i % CHART_COLORS.length],
}));

export const AQR_PRISE_TOTAL_KEY = "aqr_prise_total";

export const AQR_PRISE_SERIES: ChartSeries<MonthlyChartPoint>[] = [
  ...AQR_PRISE_KEYS.map((key, i) => ({
    key,
    label: AQR_COLUMNS.find((c) => c.key === key)!.label,
    color: CHART_COLORS[i % CHART_COLORS.length],
  })),
  {
    key: AQR_PRISE_TOTAL_KEY,
    label: "Total (kWh)",
    color: "#000000",
    strokeWidth: 3,
  },
];

export function withPriseTotal(points: MonthlyChartPoint[]): MonthlyChartPoint[] {
  return points.map((point) => {
    const total = AQR_PRISE_KEYS.reduce((sum, key) => {
      const value = point[key as string];
      return typeof value === "number" ? sum + value : sum;
    }, 0);
    return { ...point, [AQR_PRISE_TOTAL_KEY]: total };
  });
}
