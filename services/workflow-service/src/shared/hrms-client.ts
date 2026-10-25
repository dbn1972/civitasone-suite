const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";

export type ReportingLine = {
  /** The queried actor's employee name, when linked to an employee record. */
  fullName: string | null;
  /** The actor's current reporting manager (login actor id + name), or null. */
  manager: { actorId: string; fullName: string } | null;
};

const NONE: ReportingLine = { fullName: null, manager: null };

/**
 * Reporting line of an identity actor from hrms-service (GET
 * /v1/hrms/internal/employees/actor/:actorId/reporting-line, over the x-internal +
 * x-service-secret + x-tenant-id service-to-service path, same as identity-client).
 *
 * Fails SOFT: any error, non-2xx, malformed body, unreachable service or missing
 * secret yields `{ fullName: null, manager: null }`. Notices are best-effort
 * enrichment and must never block or fail a delegation write.
 */
export async function fetchReportingLine(tenantId: string, actorId: string): Promise<ReportingLine> {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) return NONE;
  try {
    const res = await fetch(`${HRMS_URL}/v1/hrms/internal/employees/actor/${encodeURIComponent(actorId)}/reporting-line`, {
      headers: { "x-internal": "1", "x-service-secret": secret, "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(Number(process.env.HRMS_LOOKUP_TIMEOUT_MS ?? 2000)),
    });
    if (!res.ok) return NONE;
    const body = (await res.json()) as { fullName?: unknown; manager?: { actorId?: unknown; fullName?: unknown } | null };
    const m = body.manager;
    return {
      fullName: typeof body.fullName === "string" && body.fullName ? body.fullName : null,
      manager: m && typeof m.actorId === "string" && m.actorId
        ? { actorId: m.actorId, fullName: typeof m.fullName === "string" ? m.fullName : "" }
        : null,
    };
  } catch {
    return NONE;
  }
}
