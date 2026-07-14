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
import type {
  ConfigEntry,
  PassVerifyResult,
  PresetName,
  RosterEntry,
  VisitRequest,
} from "./types";

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `Request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string; code?: string };
      return j.message ?? j.code ?? text;
    } catch {
      return text;
    }
  } catch {
    return `Request failed (${res.status})`;
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await browserFetch(path, {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(await readError(res));
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

/** Interactive (per-location) roster read for the guard console. */
export async function fetchRoster(locationId: string): Promise<RosterEntry[]> {
  const res = await browserFetch(
    `v1/visitor/evacuation/roster?locationId=${encodeURIComponent(locationId)}`,
  );
  if (!res.ok) throw new Error(await readError(res));
  const out = (await res.json()) as { data?: RosterEntry[] };
  return out.data ?? [];
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
  if (!res.ok) throw new Error(await readError(res));
  const out = (await res.json()) as { data?: VisitRequest[] };
  return out.data ?? [];
}

export async function setConfig(input: {
  namespace: string;
  configKey: string;
  value: unknown;
  label?: string;
  expectedVersion?: number;
}): Promise<void> {
  await post("v1/visitor/config", {
    namespace: input.namespace,
    configKey: input.configKey,
    value: input.value,
    ...(input.label ? { label: input.label } : {}),
    ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
  });
}

export async function fetchConfigNamespace(namespace: string): Promise<ConfigEntry[]> {
  const res = await browserFetch(`v1/visitor/config/${encodeURIComponent(namespace)}`);
  if (!res.ok) throw new Error(await readError(res));
  const out = (await res.json()) as { items?: ConfigEntry[] };
  return out.items ?? [];
}

export async function applyPreset(preset: PresetName): Promise<void> {
  await post(`v1/visitor/config/presets/${preset}`);
}
