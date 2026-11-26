/**
 * Master-backed value validation (owner decision sheet C5 / C6, 2026-11-26).
 *
 * A free-text scope value (price-book segment / channel, qualification-framework business line,
 * lead business line) silently never matches when it is mistyped. Where a tenant has CONFIGURED
 * a master list, the value must be one of its ACTIVE codes (HTTP 422 UNKNOWN_MASTER_VALUE, with
 * the allowed codes in the message). While a tenant's master is still EMPTY the field stays an
 * open vocabulary, so existing rows and tenants that have not set up the list yet keep working.
 *
 * Geography is not a tenant master: it comes from the existing India state / UT master
 * (ISO 3166-2:IN codes, mirrored from apps/web/src/lib/india/states.ts) via normaliseGeography.
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "./db.js";
import { HttpError } from "./context.js";

export type MasterTable = "crm.price_book_segments" | "crm.price_book_channels" | "crm.business_lines";

/** Pure: decide whether `value` is acceptable given the tenant's ACTIVE master codes. */
export function checkAgainstMaster(
  value: string,
  activeCodes: readonly string[],
): { ok: true; value: string } | { ok: false; allowed: readonly string[] } {
  if (activeCodes.length === 0) return { ok: true, value }; // master not configured -> open vocabulary
  const wanted = value.trim().toLowerCase();
  const hit = activeCodes.find((c) => c.toLowerCase() === wanted);
  return hit !== undefined ? { ok: true, value: hit } : { ok: false, allowed: activeCodes };
}

/** Active codes of one tenant master (table name is a closed union, never user input). */
export async function activeMasterCodes(tenantId: string, table: MasterTable): Promise<string[]> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT code FROM ${sql.raw(table)} WHERE tenant_id = ${tenantId} AND active = true ORDER BY sort_order, code
  `))) as unknown as Array<{ code: string }>;
  return rows.map((r) => r.code);
}

/**
 * Validate (and canonicalise to the master's stored code) one scope value. null / undefined pass
 * through untouched (the field is optional / being cleared).
 */
export async function assertMasterValue(
  tenantId: string,
  table: MasterTable,
  noun: string,
  value: string | null | undefined,
): Promise<string | null | undefined> {
  if (value === null || value === undefined) return value;
  const res = checkAgainstMaster(value, await activeMasterCodes(tenantId, table));
  if (!res.ok) {
    throw new HttpError(
      422,
      "UNKNOWN_MASTER_VALUE",
      `${noun} "${value}" is not in this tenant's ${noun} list; allowed: ${res.allowed.join(", ")}`,
    );
  }
  return res.value;
}
