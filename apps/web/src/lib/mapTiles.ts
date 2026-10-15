/**
 * Map tile configuration (GAP-LOCATIONS-MAPS-02), shared by the map pages and the
 * CSP in src/middleware.ts so the two can never drift apart.
 *
 * MAP_TILE_URL (server-side env, read at runtime) is the base-map XYZ template,
 * e.g. an on-premises tile server for Government / PSU networks:
 *   MAP_TILE_URL=https://tiles.internal.example.gov.in/{z}/{x}/{y}.png
 * Unset, the public OpenStreetMap tiles are used. Only https is accepted; anything
 * else is ignored (and the default is used) rather than weakening the CSP.
 */
const DEFAULT_TILE_ORIGIN = "https://*.tile.openstreetmap.org";

/** The configured https tile template, or undefined to use the CivitasMap default. */
export function configuredTileUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env.MAP_TILE_URL?.trim();
  if (!raw || !/^https:\/\/[^/\s]+/i.test(raw)) return undefined;
  return raw;
}

/** The CSP img-src source that covers the base-map tiles ("{s}" becomes a wildcard subdomain). */
export function tileImgSource(env: Record<string, string | undefined> = process.env): string {
  const url = configuredTileUrl(env);
  if (!url) return DEFAULT_TILE_ORIGIN;
  const origin = /^https:\/\/[^/\s]+/i.exec(url)?.[0] ?? "";
  const source = origin.replace("{s}", "*");
  // A source with any remaining template characters or a bare wildcard host would be invalid or too broad.
  return /^https:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(source) ? source : DEFAULT_TILE_ORIGIN;
}
