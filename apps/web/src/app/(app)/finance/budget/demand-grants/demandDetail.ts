import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * GAP-FINANCE-BUDGET-DEMAND-GRANTS-04: one demand for grants with its head-wise
 * (per major head) lines (GET /v1/finance/budgets/demand-grants/:id). Money is
 * bigint paise carried as strings.
 */
export type DemandLine = { id: string; headCode: string; headName: string | null; amountMinor: string };

export type DemandDetail = {
  id: string;
  demandNo: string;
  service: string;
  amountMinor: string;
  currency: string;
  class: string;
  status: string;
  lines: DemandLine[];
  linesTotalMinor: string;
  /** True once the head-wise split totals the demand amount. */
  linesReconciled: boolean;
};

export type MajorHeadOption = { code: string; name: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : d);

export function mapDemandDetail(payload: unknown): DemandDetail | null {
  const d = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  if (!d || typeof d.id !== "string" || typeof d.demandNo !== "string") return null;
  const lines = Array.isArray(d.lines)
    ? d.lines.filter(isRecord).map((l): DemandLine => ({
        id: str(l.id),
        headCode: str(l.headCode),
        headName: typeof l.headName === "string" && l.headName ? l.headName : null,
        amountMinor: str(l.amountMinor, "0"),
      }))
    : [];
  return {
    id: d.id,
    demandNo: d.demandNo,
    service: str(d.service),
    amountMinor: str(d.amountMinor, "0"),
    currency: str(d.currency, "INR"),
    class: str(d.class),
    status: str(d.status),
    lines,
    linesTotalMinor: str(d.linesTotalMinor, "0"),
    linesReconciled: d.linesReconciled === true,
  };
}

export async function getDemandGrantById(id: string): Promise<LoaderResult<DemandDetail | null>> {
  return fetchJson<unknown, DemandDetail | null>(`/api/v1/finance/budgets/demand-grants/${encodeURIComponent(id)}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "finance.demand-grant.detail",
    mapResponse: mapDemandDetail,
  });
}

/** Major (level 0) heads, for the head-wise split editor. */
export function mapMajorHeads(payload: unknown): MajorHeadOption[] | null {
  const rows = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.data) ? payload.data : null;
  if (!rows) return null;
  const out: MajorHeadOption[] = [];
  for (const r of rows) {
    if (!isRecord(r) || r.level !== 0) continue;
    const code = str(r.code);
    const name = str(r.name);
    if (code && name) out.push({ code, name });
  }
  return out;
}

export async function getMajorHeadOptions(): Promise<LoaderResult<MajorHeadOption[]>> {
  return fetchJson<unknown, MajorHeadOption[]>("/api/v1/finance/accounts?limit=500", [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.major_heads",
    mapResponse: mapMajorHeads,
  });
}
