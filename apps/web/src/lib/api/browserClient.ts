/**
 * Browser-native API client — routes through BFF /api/proxy (httpOnly session).
 * Adds device + trust headers for Gmail-style security layers.
 */
import { getOrCreateDeviceId } from "@civitasone/client-core";
import { toHumanError, type MessageKind } from "../messages";

const TRUST_KEY = "civitasone_device_trust";

function deviceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "x-device-id": getOrCreateDeviceId(),
  };
  if (typeof sessionStorage !== "undefined") {
    const trust = sessionStorage.getItem(TRUST_KEY);
    if (trust) headers["x-device-trust-token"] = trust;
  }
  return headers;
}

export async function browserFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return fetch(`/api/proxy/${normalized}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...deviceHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * Build a clerk-safe error string for a failed Response — routed through the
 * same `toHumanError` catalogue `useFormError` uses (apps/web/src/lib/
 * messages.ts), never the backend's own text.
 *
 * UX-020: this used to `await res.clone().json()` and return the server's
 * raw `code`/`message` verbatim (e.g. "ALREADY_CLOSED: period is already
 * hard-closed", "INTEGRATION_DISABLED: PFMS is offline"), falling back to
 * `API_ERROR: <status>` when the body was absent or unparseable — a raw
 * status/server-text leak structurally identical to the ones UX-003/UX-016
 * close in useFormError-based forms, just one layer lower in the stack (a
 * plain async helper, not a React hook, so it cannot call `useFormError`
 * itself — `toHumanError` is the piece of that catalogue built to be called
 * from either). See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-020.
 *
 * `kind`/`area` steer the summary line exactly like `useFormError.
 * fromResponse`'s own parameters; both are optional so the ~100 existing
 * call sites that only pass `res` keep compiling. An explicit `kind` always
 * wins; when the caller doesn't pass one, `res.status` picks between the
 * "load" and "save" catalogue entries (404 reads as "couldn't load",
 * anything else as "couldn't save") — status is read only to choose which
 * catalogue entry to use, never interpolated into the returned string.
 */
export async function errorMessageFromResponse(
  res: Response,
  kind?: MessageKind,
  area?: string,
): Promise<string> {
  const resolvedKind: MessageKind = kind ?? (res.status === 404 ? "load" : "save");
  const human = toHumanError(resolvedKind, { area });
  return `${human.what} ${human.next}`;
}

/**
 * GAP-PAYROLL-STATUTORY-PT-06: like errorMessageFromResponse, but the status
 * CLASS picks the catalogue entry -- 403 reads as a permission problem and
 * 400/422 as "values not accepted" -- instead of one generic "couldn't save".
 * OPT-IN on purpose: errorMessageFromResponse's default (the generic entry
 * for every non-404 failure) is asserted by ~50 forms' tests across other
 * modules, so changing it app-wide is a separate, deliberate change. Status is
 * only used to choose the entry; it (and any backend text) is never
 * interpolated into the message (UX-020).
 */
export async function errorMessageForStatus(res: Response, area?: string): Promise<string> {
  const kind: MessageKind | undefined =
    res.status === 403 ? "forbidden"
    : res.status === 400 || res.status === 422 ? "invalid"
    : undefined;
  return errorMessageFromResponse(res, kind, area);
}

/**
 * The machine-readable `code` from a failed API response body (e.g.
 * "SELF_DISBURSE_FORBIDDEN"), or null when absent/unparseable. For callers
 * that map a few KNOWN codes to their own translated copy -- never display
 * the code itself; fall back to errorMessageFromResponse for anything else.
 * Reads a clone, so the response can still be consumed afterwards.
 */
export async function errorCodeFromResponse(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { code?: unknown } | null;
    return body && typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export async function browserJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await browserFetch(path, init);
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return res.json() as Promise<T>;
}

/** Request step-up token for sensitive mutations (finance approvals, etc.). */
export async function requestStepUp(): Promise<string> {
  const res = await browserFetch("v1/devices/step-up", { method: "POST" });
  if (!res.ok) throw new Error("STEP_UP_REQUIRED");
  const data = (await res.json()) as { stepUpToken: string };
  return data.stepUpToken;
}
