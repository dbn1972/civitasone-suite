import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

export type PeriodRow = {
  period: string;
  fiscalYear: string;
  status: string;
  closedBy: string | null;
  closedAt: string | null;
} & Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** GET /v1/finance/periods row mapper, shared by the period-close cockpit and the fiscal-year activation check. */
export function mapPeriods(payload: unknown): PeriodRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;

  const mapped: PeriodRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const period = raw.period;
    const status = raw.status;
    if (typeof period !== "string" || typeof status !== "string") continue;
    mapped.push({
      period,
      fiscalYear: typeof raw.fiscalYear === "string" ? raw.fiscalYear : "",
      status,
      closedBy: typeof raw.closedBy === "string" ? raw.closedBy : null,
      closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
    });
  }
  // Most recently touched period first.
  mapped.sort((a, b) => (b.period > a.period ? 1 : b.period < a.period ? -1 : 0));
  return mapped;
}

export async function getPeriods(): Promise<LoaderResult<PeriodRow[]>> {
  return fetchJson<unknown, PeriodRow[]>("/api/v1/finance/periods", [], {
    telemetryKey: "finance.periods",
    mapResponse: mapPeriods,
  });
}
