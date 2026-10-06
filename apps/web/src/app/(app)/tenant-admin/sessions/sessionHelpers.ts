/**
 * Shared, pure helpers for the Active Sessions screens so the KPI tiles
 * (page.tsx) and the table (SessionsTable.tsx) count and label networks the
 * SAME way. Before GAP-TENANT-ADMIN-SESSIONS-03/05 the page computed
 * "Locations" from the first two IP octets while the table collapsed every
 * RFC-1918 range to one "Internal network" label, so the tile and the column
 * disagreed and neither meant a geographic location.
 */

/**
 * A stable "network" key for an IP address, used both for the distinct-network
 * KPI and the table's Network column so the two always agree:
 *  - any RFC-1918 private range (10.x, 192.168.x, 172.16-31.x) -> "internal"
 *  - any other IPv4 -> its first two octets ("203.0") as a coarse public net
 *  - missing/unparseable -> "unknown"
 */
export function networkKey(ip?: string | null): string {
  if (!ip) return "unknown";
  const trimmed = ip.trim();
  if (
    trimmed.startsWith("10.") ||
    trimmed.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(trimmed)
  ) {
    return "internal";
  }
  const octets = trimmed.split(".");
  if (octets.length >= 2 && octets[0] !== "") return `${octets[0]}.${octets[1]}`;
  return "unknown";
}

/** Human label for the network of an IP (matches networkKey grouping). */
export function networkLabel(ip?: string | null): string {
  const key = networkKey(ip);
  if (key === "unknown") return "—";
  if (key === "internal") return "Internal network";
  return `${key}.x.x`;
}

/** Count of distinct networks across sessions (ignores unknown). */
export function distinctNetworkCount(ips: (string | null | undefined)[]): number {
  const keys = new Set<string>();
  for (const ip of ips) {
    const key = networkKey(ip);
    if (key !== "unknown") keys.add(key);
  }
  return keys.size;
}

/** Derive a friendly "Browser · OS" device label from a User-Agent string. */
export function deviceLabel(ua?: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg/i.test(ua) ? "Edge" : /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "Browser";
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}
