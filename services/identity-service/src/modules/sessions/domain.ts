export type SessionStatus = "active" | "revoked" | "expired";

/**
 * OWNER DECISION #21 (TENANT-ADMIN-SESSIONS-DETAIL-05, DPDP): the full user
 * agent string is a fingerprint, so admin views carry only "<browser> on <OS>".
 */
export function shortUserAgent(ua: string | null | undefined): string | null {
  if (!ua || ua.trim().length === 0) return null;
  const browser = /Edg(?:e|A|iOS)?\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  const os = /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

/** Mask a source IP for admin views: keep the network prefix only (10.1.*.*). */
export function maskSessionIp(ip: string): string {
  const v = ip.trim();
  if (v.includes(":")) return `${v.split(":")[0] ?? ""}:*:*:*`;
  const parts = v.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  return "***";
}

export type SessionView = {
  id: string;
  tenantId: string;
  userId: string;
  ip: string;
  device: string | null;
  mfaMethod: string | null;
  trusted: boolean;
  status: SessionStatus;
  userEmail: string;
  userName: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  startedAt: string;
  expiresAt: string;
  version: number;
};
