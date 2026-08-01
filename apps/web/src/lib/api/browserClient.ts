/**
 * Browser-native API client — routes through BFF /api/proxy (httpOnly session).
 * Adds device + trust headers for Gmail-style security layers.
 */
import { getOrCreateDeviceId } from "@civitasone/client-core";

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
 * Extract a human-usable error string from a failed Response, preferring the
 * server's own `code`/`message` (e.g. "ALREADY_CLOSED: period is already
 * hard-closed" or "INTEGRATION_DISABLED: PFMS is offline") over a bare HTTP
 * status. Falls back to `API_ERROR: <status>` when the body is absent or
 * unparseable, preserving the historic contract for callers/tests that only
 * see a status.
 */
export async function errorMessageFromResponse(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    };
    const code = body.code ?? body.error?.code;
    const message = body.message ?? body.error?.message;
    if (code && message) return `${code}: ${message}`;
    const single = message ?? code;
    if (single) return single;
  } catch {
    // no body / not JSON — fall through to the status fallback
  }
  return `API_ERROR: ${res.status}`;
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
