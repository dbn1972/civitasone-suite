/**
 * Session device/location presentation helpers, shared by the tenant-admin
 * session list (tenant-admin/sessions/SessionsTable) and the per-user session
 * table (tenant-admin/users/[id]/UserSessionsTable) so the two cannot drift.
 * GAP-TENANT-ADMIN-USERS-DETAIL-05.
 */

/** Derive a friendly device label from a User-Agent string. */
export function deviceLabel(ua?: string): string {
  if (!ua) return "Unknown device";
  const browser = /Edg/i.test(ua) ? "Edge" : /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "Browser";
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Best-effort location hint from the IP (network prefix). */
export function locationLabel(ip?: string): string {
  if (!ip) return "—";
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.")) return "Internal network";
  return `${ip.split(".").slice(0, 2).join(".")}.x.x`;
}
