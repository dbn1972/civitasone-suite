"use client";

import { getOrCreateDeviceId } from "@civitasone/client-core";

const TRUST_KEY = "civitasone_device_trust";

export function getTrustToken(): string | undefined {
  // CLOS2-S3-03: blocked storage throws SecurityError; treat as "no token".
  try {
    if (typeof sessionStorage === "undefined") return undefined;
    return sessionStorage.getItem(TRUST_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setTrustToken(token: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(TRUST_KEY, token);
  } catch {
    // storage unavailable: the token simply isn't persisted
  }
}

export function clearTrustToken(): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(TRUST_KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}

/** Device-scoped sync headers shared by the provider, mutations, and reads. */
export function buildSyncHeaders(): Record<string, string> {
  const h: Record<string, string> = { "x-device-id": getOrCreateDeviceId() };
  const trust = getTrustToken();
  if (trust) h["x-device-trust-token"] = trust;
  return h;
}
