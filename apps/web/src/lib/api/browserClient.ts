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

export async function browserJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await browserFetch(path, init);
  if (!res.ok) throw new Error(`API_ERROR: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Request step-up token for sensitive mutations (finance approvals, etc.). */
export async function requestStepUp(): Promise<string> {
  const res = await browserFetch("v1/devices/step-up", { method: "POST" });
  if (!res.ok) throw new Error("STEP_UP_REQUIRED");
  const data = (await res.json()) as { stepUpToken: string };
  return data.stepUpToken;
}
