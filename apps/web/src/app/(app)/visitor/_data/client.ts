/**
 * visitor feature — client-side API calls (mutations + interactive reads).
 *
 * Uses the app's browser client (src/lib/api/browserClient.ts) which routes
 * through the BFF proxy /api/proxy/<path> (httpOnly session cookie + device
 * headers). Paths are the gateway paths WITHOUT the /api prefix, e.g.
 * "v1/visitor/...". Every function throws on non-2xx; callers show a
 * plain-language error state.
 */
import { browserFetch } from "@/lib/api/browserClient";
import { toHumanError, type MessageKind } from "@/lib/messages";
import type {
  ActiveVisitor,
  ConfigEntry,
  PassVerifyResult,
  PresetName,
  RosterEntry,
  VisitRequest,
} from "./types";

/**
 * Plain-language failure message for any non-2xx response from a
 * visitor-data mutation/read. Every exported function below throws
 * `Error(readError())` and callers render that message directly as the UI's
 * error state, so it must never be (or contain) a raw HTTP status code or raw
 * server response body — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md
 * UX-003/UX-016. This module is a plain async data-fetching client, not a
 * component, so it can't use the useFormError hook; toHumanError is the same
 * catalogued-message building block that hook is built on.
 */
function readError(kind: MessageKind): string {
  const human = toHumanError(kind, { area: "visitor data" });
  return `${human.what} ${human.next}`;
}

/**
 * GAP-VISITOR-ADMIN-06: a 409 (optimistic-lock version conflict) is a distinct
 * failure from a generic save error — the caller should reload and ask the
 * admin to review, not just retry blindly. Thrown by post() on a 409 so
 * callers can branch on it. (The config write path is CQRS/202, so a conflict
 * typically surfaces on the next read; this covers any synchronous 409 too.)
 */
export class ConflictError extends Error {
  constructor(message = "This setting was changed by someone else.") {
    super(message);
    this.name = "ConflictError";
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await browserFetch(path, {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 409) throw new ConflictError();
  if (!res.ok) throw new Error(readError("save"));
  return (await res.json()) as T;
}

/** Gate pass verification (synchronous, <2s). */
export async function verifyPass(input: {
  gateId: string;
  qrToken: string;
  identityDocHash?: string;
}): Promise<PassVerifyResult> {
  const out = await post<{ data: PassVerifyResult }>("v1/visitor/passes/verify", {
    gateId: input.gateId,
    qrToken: input.qrToken,
    ...(input.identityDocHash ? { identityDocHash: input.identityDocHash } : {}),
  });
  return out.data;
}

export async function recordCheckIn(passId: string, gateId: string): Promise<void> {
  await post("v1/visitor/check-ins", { passId, gateId });
}

export async function recordCheckOut(passId: string, gateId: string): Promise<void> {
  await post("v1/visitor/check-outs", { passId, gateId });
}

/**
 * Interactive (per-location) roster read for the guard console.
 *
 * GAP-VISITOR-GUARD-01: uses the NORMAL role-gated live-occupancy endpoint
 * `GET /v1/visitor/check-ins/active` (visitor-service check-in/routes.ts),
 * NOT the break-glass evacuation roster, which is fail-closed IP-allowlisted
 * and 403s every ordinary guard console. The active endpoint returns only the
 * fields a guard needs — name, host id, check-in time, validUntil, overstay —
 * and no raw phone/email/identity document.
 */
export async function fetchRoster(locationId: string): Promise<RosterEntry[]> {
  const qs = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  const res = await browserFetch(`v1/visitor/check-ins/active${qs}`);
  if (!res.ok) throw new Error(readError("load"));
  const out = (await res.json()) as { data?: { visitors?: ActiveVisitor[] } };
  const visitors = out.data?.visitors ?? [];
  return visitors.map((v) => ({
    passId: v.passId,
    visitorName: v.visitorName,
    hostEmployeeId: v.hostEmployeeId,
    locationId: v.locationId,
    checkInTime: v.checkInTime ?? "",
    validUntil: v.validUntil ?? null,
    overstay: Boolean(v.overstay),
    evacuated: false,
  }));
}

export async function approveVisitRequest(id: string): Promise<void> {
  await post(`v1/visitor/visit-requests/${id}/approve`);
}

export async function rejectVisitRequest(id: string, reason: string): Promise<void> {
  await post(`v1/visitor/visit-requests/${id}/reject`, { reason });
}

/** Refresh a status-filtered list of visit requests (interactive tables). */
export async function fetchVisitRequests(status: string): Promise<VisitRequest[]> {
  const res = await browserFetch(
    `v1/visitor/visit-requests?status=${encodeURIComponent(status)}`,
  );
  if (!res.ok) throw new Error(readError("load"));
  const out = (await res.json()) as { data?: VisitRequest[] };
  return out.data ?? [];
}

export async function setConfig(input: {
  namespace: string;
  configKey: string;
  value: unknown;
  label?: string;
  expectedVersion?: number;
  /** GAP-VISITOR-ADMIN-03: audit reason for a policy change (forwarded to the service). */
  reason?: string;
}): Promise<void> {
  await post("v1/visitor/config", {
    namespace: input.namespace,
    configKey: input.configKey,
    value: input.value,
    ...(input.label ? { label: input.label } : {}),
    ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

export async function fetchConfigNamespace(namespace: string): Promise<ConfigEntry[]> {
  const res = await browserFetch(`v1/visitor/config/${encodeURIComponent(namespace)}`);
  if (!res.ok) throw new Error(readError("load"));
  const out = (await res.json()) as { items?: ConfigEntry[] };
  return out.items ?? [];
}

export async function applyPreset(preset: PresetName, reason?: string): Promise<void> {
  await post(`v1/visitor/config/presets/${preset}`, reason ? { reason } : undefined);
}
