/**
 * Gmail-style device identity — each browser/installation is a first-class device.
 * Server binds sessions to device_id + issues device_trust_token after verification.
 */

export type DevicePlatform = "web" | "ios" | "android" | "desktop";
export type DeviceTrustLevel = "unknown" | "recognized" | "trusted" | "step_up_required";

export type DeviceIdentity = {
  deviceId: string;
  platform: DevicePlatform;
  label: string;
  fingerprint: string;
  trustLevel: DeviceTrustLevel;
  trustToken?: string;
  registeredAt: string;
  lastSeenAt: string;
};

export type DeviceRegisterRequest = {
  deviceId: string;
  platform: DevicePlatform;
  label: string;
  fingerprint: string;
  userAgent?: string;
};

export type DeviceRegisterResponse = {
  deviceId: string;
  trustToken: string;
  trustLevel: DeviceTrustLevel;
};

const DEVICE_ID_KEY = "civitasone_device_id";

/** Stable device UUID — persisted per browser/installation. */
export function getOrCreateDeviceId(storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void }): string {
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return crypto.randomUUID();
  const existing = store.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  store.setItem(DEVICE_ID_KEY, id);
  return id;
}

/** Browser fingerprint hash for device binding (not used for tracking). */
export async function computeBrowserFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function defaultDeviceLabel(platform: DevicePlatform): string {
  if (platform === "web") return `Web — ${navigator.platform}`;
  return `${platform} device`;
}
