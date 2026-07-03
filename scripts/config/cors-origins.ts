/**
 * Production CORS whitelist.
 * Services read CORS_ORIGIN from env.
 * Set CORS_ORIGIN=https://app.civitasone.gov.in,https://admin.civitasone.gov.in
 * In dev: CORS_ORIGIN is not set → Fastify cors plugin uses `false` (allow all in dev)
 */
export const PRODUCTION_ORIGINS = [
  "https://app.civitasone.gov.in",
  "https://admin.civitasone.gov.in",
  "https://portal.civitasone.gov.in",
  "https://demo.civitasone.app",
];

/**
 * Parse CORS_ORIGIN from environment variable.
 * Returns `false` (allow all) when not set (dev mode).
 * Returns array of origins when set (production).
 */
export function parseCorsOrigins(): string[] | false {
  const raw = process.env["CORS_ORIGIN"];
  if (!raw || raw.trim() === "") return false;
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}
