/**
 * change/release feature — server-side loaders (Server Components only).
 *
 * Follows the app convention (see src/app/_data/apiClient.ts): every loader
 * returns LoaderResult<T> and never throws — on any failure it yields empty
 * data + source:"error" so pages degrade gracefully via <DataSourceBadge/>.
 *
 * Gateway routing: "/api/v1/admin/change/..." is rewritten to the admin
 * service's "/v1/admin/change/...".
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ChangeRequest, ChangeAuditEntry, ChangeDetail, ChangeFreeze } from "./types";

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
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((s) => String(s)) : [];
}

function mapChange(row: Record<string, unknown>): ChangeRequest {
  return {
    id: str(row.id),
    title: str(row.title),
    type: str(row.type, "normal") as ChangeRequest["type"],
    risk: str(row.risk, "medium") as ChangeRequest["risk"],
    affectedServices: strArray(row.affectedServices),
    description: str(row.description),
    rollbackPlan: strOrNull(row.rollbackPlan),
    status: str(row.status, "draft") as ChangeRequest["status"],
    requestedBy: str(row.requestedBy),
    approvedBy: strOrNull(row.approvedBy),
    approvedAt: strOrNull(row.approvedAt),
    rejectedReason: strOrNull(row.rejectedReason),
    windowStart: strOrNull(row.windowStart),
    windowEnd: strOrNull(row.windowEnd),
    releaseNotes: strOrNull(row.releaseNotes),
    pirOutcome: (strOrNull(row.pirOutcome) as ChangeRequest["pirOutcome"]) ?? null,
    pirNotes: strOrNull(row.pirNotes),
    pirAt: strOrNull(row.pirAt),
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
  };
}

function mapAudit(row: Record<string, unknown>): ChangeAuditEntry {
  return {
    id: str(row.id),
    fromStatus: strOrNull(row.fromStatus),
    toStatus: str(row.toStatus),
    actorId: str(row.actorId),
    note: strOrNull(row.note),
    at: str(row.at),
  };
}

export async function getChangeRequests(): Promise<LoaderResult<ChangeRequest[]>> {
  return fetchJson<unknown, ChangeRequest[]>("/api/v1/admin/change/requests", [], {
    telemetryKey: "change.requests.list",
    revalidateSeconds: 15,
    mapResponse: (payload) => {
      const obj = asObj(payload);
      return asArray(obj?.data ?? payload).map(mapChange);
    },
  });
}

export async function getChangeRequest(id: string): Promise<LoaderResult<ChangeDetail | null>> {
  return fetchJson<unknown, ChangeDetail | null>(`/api/v1/admin/change/requests/${id}`, null, {
    telemetryKey: "change.requests.detail",
    mapResponse: (payload) => {
      const obj = asObj(payload);
      const data = asObj(obj?.data);
      if (!data) return null;
      return { data: mapChange(data), audit: asArray(obj?.audit).map(mapAudit) };
    },
  });
}

export async function getChangeFreezes(): Promise<LoaderResult<ChangeFreeze[]>> {
  return fetchJson<unknown, ChangeFreeze[]>("/api/v1/admin/change/freezes", [], {
    telemetryKey: "change.freezes.list",
    revalidateSeconds: 30,
    mapResponse: (payload) => {
      const obj = asObj(payload);
      return asArray(obj?.data ?? payload).map((r) => ({
        id: str(r.id),
        name: str(r.name),
        startsAt: str(r.startsAt),
        endsAt: str(r.endsAt),
        reason: str(r.reason),
      }));
    },
  });
}
