/**
 * court feature — server-side loaders (Server Components only).
 *
 * Follows the app convention (see src/app/_data/apiClient.ts): every loader
 * returns LoaderResult<T> = { data, source } and never throws. On any failure
 * (no base URL, 401, network, bad shape) it returns empty data with
 * source:"error" so pages degrade gracefully via <DataSourceBadge/>.
 *
 * Gateway routing: paths are prefixed "/api/v1/court/..." — the gateway
 * (services/gateway-service/src/registry.ts) rewrites the "/api/v1/court"
 * prefix to the service's internal base "/v1/court". So
 *   GET /api/v1/court/cases            → GET /v1/court/cases           (list)
 *   GET /api/v1/court/cases/:id        → GET /v1/court/cases/:id       (+ parties)
 *   GET /api/v1/court/cases/:id/orders → GET /v1/court/cases/:id/orders
 *   GET /api/v1/court/config/:ns       → GET /v1/court/config/:ns
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type {
  CaseAnalytics,
  CaseParty,
  CaseStatus,
  ConfigEntry,
  CourtCase,
  CourtCaseDetail,
  CourtOrder,
  Hearing,
  OrderStatus,
  Pendency,
} from "./types";

// ─── small coercers ──────────────────────────────────────────────────────────

function pickData(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

/** Court read models wrap rows as { items, count, source }. */
function pickItems(payload: unknown): Record<string, unknown>[] {
  if (payload && typeof payload === "object" && "items" in payload) {
    const items = (payload as { items: unknown }).items;
    return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
  }
  return asArray(pickData(payload));
}

function asArray(x: unknown): Record<string, unknown>[] {
  return Array.isArray(x) ? (x as Record<string, unknown>[]) : [];
}

function asObj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown): boolean {
  return v === true;
}

// ─── mappers ─────────────────────────────────────────────────────────────────

function mapCase(o: Record<string, unknown>): CourtCase {
  return {
    id: str(o.id),
    cnrNumber: str(o.cnrNumber),
    caseType: strOrNull(o.caseType),
    filingNumber: strOrNull(o.filingNumber),
    filingDate: strOrNull(o.filingDate),
    title: strOrNull(o.title),
    status: str(o.status, "filed") as CaseStatus,
    stage: strOrNull(o.stage),
    courtId: strOrNull(o.courtId),
    benchId: strOrNull(o.benchId),
    disposalDate: strOrNull(o.disposalDate),
    targetDisposalDate: strOrNull(o.targetDisposalDate),
    version: num(o.version, 1),
  };
}

function mapParty(o: Record<string, unknown>): CaseParty {
  // PII columns are AES-256-GCM; the gateway may return the decrypted value
  // under the same key (nameEnc) or a plain `name` — read whichever is present.
  const name = strOrNull(o.name) ?? strOrNull(o.nameEnc);
  return {
    id: str(o.id),
    caseId: str(o.caseId),
    partyRole: str(o.partyRole),
    name,
    advocateName: strOrNull(o.advocateName),
    advocateBarId: strOrNull(o.advocateBarId),
    version: num(o.version, 1),
  };
}

function mapOrder(o: Record<string, unknown>): CourtOrder {
  return {
    id: str(o.id),
    caseId: str(o.caseId),
    hearingId: strOrNull(o.hearingId),
    orderType: strOrNull(o.orderType),
    orderText: strOrNull(o.orderText),
    status: str(o.status, "draft") as OrderStatus,
    orderDate: strOrNull(o.orderDate),
    signedBy: strOrNull(o.signedBy),
    approvedBy: strOrNull(o.approvedBy),
    issuedAt: strOrNull(o.issuedAt),
    recallReason: strOrNull(o.recallReason),
    hasDsc: typeof o.dscSignature === "string" && o.dscSignature.length > 0,
    createdBy: strOrNull(o.createdBy),
    version: num(o.version, 1),
  };
}

function mapHearing(o: Record<string, unknown>): Hearing {
  return {
    id: str(o.id),
    caseId: str(o.caseId),
    benchId: strOrNull(o.benchId),
    scheduledDate: strOrNull(o.scheduledDate),
    status: str(o.status, "scheduled"),
    nextDate: strOrNull(o.nextDate),
    purpose: strOrNull(o.purpose),
    adjournmentReason: strOrNull(o.adjournmentReason),
    version: num(o.version, 1),
  };
}

function mapConfig(payload: unknown): ConfigEntry[] {
  return pickItems(payload).map((o) => ({
    id: str(o.id),
    namespace: str(o.namespace),
    configKey: str(o.configKey),
    value: o.value,
    label: strOrNull(o.label),
    description: strOrNull(o.description),
    active: o.active !== false,
    sortOrder: num(o.sortOrder),
    version: num(o.version, 1),
  }));
}

// ─── loaders ─────────────────────────────────────────────────────────────────

/** List cases, newest first. Optional status filter (e.g. "pending"). */
export function getCases(status?: CaseStatus): Promise<LoaderResult<CourtCase[]>> {
  const qs = status ? `?status=${encodeURIComponent(status)}&limit=100` : "?limit=100";
  return fetchJson<unknown, CourtCase[]>(`/api/v1/court/cases${qs}`, [], {
    revalidateSeconds: 15,
    telemetryKey: `court.cases.${status ?? "all"}`,
    mapResponse: (p) => pickItems(p).map(mapCase),
  });
}

/** One case with its parties (GET /cases/:id → { ...case, parties }). */
export function getCase(caseId: string): Promise<LoaderResult<CourtCaseDetail | null>> {
  return fetchJson<unknown, CourtCaseDetail | null>(
    `/api/v1/court/cases/${encodeURIComponent(caseId)}`,
    null,
    {
      telemetryKey: "court.case.detail",
      mapResponse: (p) => {
        const o = asObj(pickData(p));
        if (!o || !o.id) return null;
        return { ...mapCase(o), parties: asArray(o.parties).map(mapParty) };
      },
    },
  );
}

export function getCaseOrders(caseId: string): Promise<LoaderResult<CourtOrder[]>> {
  return fetchJson<unknown, CourtOrder[]>(
    `/api/v1/court/cases/${encodeURIComponent(caseId)}/orders`,
    [],
    {
      telemetryKey: "court.case.orders",
      mapResponse: (p) => pickItems(p).map(mapOrder),
    },
  );
}

export function getCaseHearings(caseId: string): Promise<LoaderResult<Hearing[]>> {
  return fetchJson<unknown, Hearing[]>(
    `/api/v1/court/cases/${encodeURIComponent(caseId)}/hearings`,
    [],
    {
      telemetryKey: "court.case.hearings",
      mapResponse: (p) => pickItems(p).map(mapHearing),
    },
  );
}

/** Pendency roll-up (GET /cases/pendency → { summary, total }). */
export function getPendency(): Promise<LoaderResult<Pendency>> {
  return fetchJson<unknown, Pendency>(
    `/api/v1/court/cases/pendency`,
    { summary: [], total: 0 },
    {
      revalidateSeconds: 30,
      telemetryKey: "court.pendency",
      mapResponse: (p) => {
        const o = asObj(p) ?? {};
        return {
          summary: asArray(o.summary).map((r) => ({
            status: str(r.status),
            count: num(r.count),
          })),
          total: num(o.total),
        };
      },
    },
  );
}

/** NCMS-style analytics (GET /cases/analytics → clearance + counts). */
export function getAnalytics(): Promise<LoaderResult<CaseAnalytics>> {
  return fetchJson<unknown, CaseAnalytics>(
    `/api/v1/court/cases/analytics`,
    { instituted: 0, disposed: 0, clearanceRatePct: null },
    {
      revalidateSeconds: 30,
      telemetryKey: "court.analytics",
      mapResponse: (p) => {
        const o = asObj(p) ?? {};
        return {
          instituted: num(o.instituted),
          disposed: num(o.disposed),
          clearanceRatePct:
            typeof o.clearanceRatePct === "number" ? o.clearanceRatePct : null,
        };
      },
    },
  );
}

/** All config entries in a namespace (e.g. "case_type", "sla_timer"). */
export function getConfigNamespace(namespace: string): Promise<LoaderResult<ConfigEntry[]>> {
  return fetchJson<unknown, ConfigEntry[]>(
    `/api/v1/court/config/${encodeURIComponent(namespace)}`,
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: `court.config.${namespace}`,
      mapResponse: mapConfig,
    },
  );
}
