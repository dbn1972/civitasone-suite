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
import { recordLoaderFallback } from "@/app/_data/loaderTelemetry";
import type { ChangeRequest, ChangeAuditEntry, ChangeDetail, ChangeFreeze } from "./types";
import { changeRequestSchema, changeAuditEntrySchema, changeFreezeSchema } from "./types";

function asArray(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}
function asObj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/**
 * GAP-CHANGE-HOME-06: safe-parse each row against the zod schema. Invalid rows
 * (e.g. a renamed status, a missing/non-UUID id after a backend shape change)
 * are DROPPED and counted, not coerced to a misleading "draft" default — a
 * silently-defaulted row previously made every change look like a draft and
 * offered draft actions on it. The dropped count is reported via loader
 * telemetry so backend drift surfaces instead of hiding.
 */
function parseRows<T>(
  rows: unknown[],
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  telemetryKey: string,
  path: string,
): T[] {
  const out: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success && parsed.data !== undefined) out.push(parsed.data);
    else dropped += 1;
  }
  if (dropped > 0) {
    recordLoaderFallback({
      key: telemetryKey,
      reason: "invalid_payload",
      path,
      timestamp: new Date().toISOString(),
    });
  }
  return out;
}

export async function getChangeRequests(): Promise<LoaderResult<ChangeRequest[]>> {
  const path = "/api/v1/admin/change/requests";
  return fetchJson<unknown, ChangeRequest[]>(path, [], {
    telemetryKey: "change.requests.list",
    revalidateSeconds: 15,
    mapResponse: (payload) => {
      const obj = asObj(payload);
      return parseRows<ChangeRequest>(asArray(obj?.data ?? payload), changeRequestSchema, "change.requests.list", path);
    },
  });
}

export async function getChangeRequest(id: string): Promise<LoaderResult<ChangeDetail | null>> {
  const path = `/api/v1/admin/change/requests/${id}`;
  return fetchJson<unknown, ChangeDetail | null>(path, null, {
    telemetryKey: "change.requests.detail",
    mapResponse: (payload) => {
      const obj = asObj(payload);
      const parsed = changeRequestSchema.safeParse(asObj(obj?.data));
      if (!parsed.success) return null;
      return {
        data: parsed.data,
        audit: parseRows<ChangeAuditEntry>(asArray(obj?.audit), changeAuditEntrySchema, "change.requests.detail", path),
      };
    },
  });
}

export async function getChangeFreezes(): Promise<LoaderResult<ChangeFreeze[]>> {
  const path = "/api/v1/admin/change/freezes";
  return fetchJson<unknown, ChangeFreeze[]>(path, [], {
    telemetryKey: "change.freezes.list",
    revalidateSeconds: 30,
    mapResponse: (payload) => {
      const obj = asObj(payload);
      return parseRows<ChangeFreeze>(asArray(obj?.data ?? payload), changeFreezeSchema, "change.freezes.list", path);
    },
  });
}
