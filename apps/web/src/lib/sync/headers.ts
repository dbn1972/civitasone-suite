"use client";

import { getOrCreateDeviceId } from "@civitasone/client-core";

const TRUST_KEY = "civitasone_device_trust";

export function getTrustToken(): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  return sessionStorage.getItem(TRUST_KEY) ?? undefined;
}

export function setTrustToken(token: string): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(TRUST_KEY, token);
}

export function clearTrustToken(): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(TRUST_KEY);
}

/** Device-scoped sync headers shared by the provider, mutations, and reads. */
export function buildSyncHeaders(): Record<string, string> {
  const h: Record<string, string> = { "x-device-id": getOrCreateDeviceId() };
  const trust = getTrustToken();
  if (trust) h["x-device-trust-token"] = trust;
  return h;
}
