#!/usr/bin/env node
/**
 * payroll-service: seal legacy DSC secrets at rest (P0 DSC passphrase fix).
 *
 * Seals, in place and idempotently:
 *   - payroll.dsc_config.passphrase values without an "enc:" envelope prefix;
 *   - DSC keystore (P12) objects in object storage that are still raw DER.
 * Then drops both the pre-fix ("dsc_config", which held the DECRYPTED
 * passphrase) and current ("dsc_config:v2") read-cache entries for every
 * touched tenant.
 *
 * Uses the SAME compiled pii-crypto envelope as the service (dist build), so
 * the wire format and key derivation are byte-identical.
 *
 * Requires env (same values as the running payroll-service):
 *   DSC_BACKFILL_DATABASE_URL  a role that bypasses RLS on payroll.dsc_config
 *                              (FORCE RLS) and can UPDATE it — e.g. the
 *                              migration/owner superuser DSN. Falls back to
 *                              DATABASE_URL (only sees rows if that role
 *                              bypasses RLS).
 *   PII_ENC_KEY (+ optional PII_KEY_ID / PII_ENC_SALT / PII_ENC_KEYRING)
 *   S3 / storage env used by @civitasone/storage
 *   REDIS_URL (optional; cache invalidation is skipped with CACHE_DRIVER=memory)
 *
 * Run from services/payroll-service AFTER `pnpm build`:
 *   node scripts/backfill-dsc-secrets.mjs
 * Output: one JSON line of counts (no secret material). Exit 1 on failure, if
 * any keystore could not be processed (re-run once storage is reachable), or
 * if any ALREADY-sealed value fails to decrypt with the configured keyring
 * (decryptErrors: wrong key at rollout — stop and fix the key first).
 * After a clean run, set DSC_ALLOW_LEGACY_UNSEALED=false on payroll +
 * payroll-worker and VALIDATE migration 0051's constraint.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getObject, putObject } from "@civitasone/storage";
import { Cache } from "@civitasone/cache";
import { backfillDscSecrets } from "../dist/modules/dsc-config/backfill.js";

const url = process.env.DSC_BACKFILL_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DSC_BACKFILL_DATABASE_URL (or DATABASE_URL) is required");
  process.exit(1);
}
// Fail fast (pii-crypto would also throw on first use).
if (!process.env.PII_ENC_KEY || process.env.PII_ENC_KEY.length < 16) {
  console.error("PII_ENC_KEY (>=16 chars) is required to seal DSC secrets");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const cache = new Cache({ service: "payroll" });
let code = 0;
try {
  const result = await backfillDscSecrets(drizzle(client), { getObject, putObject }, {
    onRowSealed: async (tenantId) => {
      await cache.invalidate(cache.makeKey(tenantId, "dsc_config", tenantId));
      await cache.invalidate(cache.makeKey(tenantId, "dsc_config:v2", tenantId));
    },
  });
  const [{ remaining }] = await client`
    SELECT count(*)::int AS remaining FROM payroll.dsc_config
    WHERE passphrase NOT LIKE 'enc:v1:%' AND passphrase NOT LIKE 'enc:v2:%'
  `;
  console.log(JSON.stringify({ ...result, remainingUnsealed: remaining }));
  if (result.keystoreErrors.length > 0 || result.decryptErrors.length > 0 || remaining > 0) code = 1;
} catch (e) {
  console.error("dsc backfill failed:", e instanceof Error ? e.message : "unknown error");
  code = 1;
} finally {
  await client.end();
}
process.exit(code);
