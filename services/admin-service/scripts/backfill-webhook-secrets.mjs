#!/usr/bin/env node
/**
 * admin-service: seal legacy plaintext webhook HMAC secrets at rest (FQ12-SEC).
 *
 * Seals, in place and idempotently, every value without the "enc:v2:" envelope
 * prefix in:
 *   webhooks.webhooks.secret, webhooks.webhooks.previous_secret,
 *   webhooks.secret_rotations.new_secret            (DB civitas_admin)
 * then drops the per-tenant webhook list cache entries.
 *
 * Uses the SAME compiled secret-crypto envelope as the service (dist build), so
 * the wire format and key derivation are byte-identical.
 *
 * Requires env (same key values as the running admin-service + admin-worker):
 *   WEBHOOK_SECRET_BACKFILL_DATABASE_URL  a role that bypasses RLS on the
 *                     webhooks.* tables (FORCE RLS) and can UPDATE them, e.g.
 *                     the migration/owner superuser DSN. Falls back to
 *                     DATABASE_URL (only sees rows if that role bypasses RLS).
 *   PII_ENC_KEY       (= ADMIN_PII_KEY / ~/.civitasone-admin-pii-key)
 *                     + optional PII_KEY_ID / PII_ENC_SALT / PII_ENC_KEYRING
 *   REDIS_URL         optional; cache invalidation is skipped with CACHE_DRIVER=memory
 *
 * Run from services/admin-service AFTER `pnpm build`:
 *   node scripts/backfill-webhook-secrets.mjs
 * Output: one JSON line of counts (no secret material). Exit 1 on failure, when
 * any value is still unsealed afterwards, or when an ALREADY-sealed value does
 * not decrypt with the configured keyring (wrong key: stop and fix the key).
 * Safe to re-run.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { Cache } from "@civitasone/cache";
import { backfillWebhookSecrets, countUnsealedWebhookSecrets } from "../dist/modules/webhooks/secret-backfill.js";

const url = process.env.WEBHOOK_SECRET_BACKFILL_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("WEBHOOK_SECRET_BACKFILL_DATABASE_URL (or DATABASE_URL) is required");
  process.exit(1);
}
if (!process.env.PII_ENC_KEY || process.env.PII_ENC_KEY.length < 16) {
  console.error("PII_ENC_KEY (>=16 chars) is required to seal webhook secrets");
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);
let code = 0;
try {
  const result = await backfillWebhookSecrets(db);
  const remainingUnsealed = await countUnsealedWebhookSecrets(db);
  const tenants = await client`SELECT DISTINCT tenant_id::text AS tenant_id FROM webhooks.webhooks`;
  const cache = new Cache({ service: "admin" });
  for (const { tenant_id } of tenants) {
    await cache.invalidate(cache.makeKey(tenant_id, "webhook", "list"));
  }
  console.log(JSON.stringify({ ...result, decryptErrors: result.decryptErrors.length, remainingUnsealed }));
  if (result.decryptErrors.length > 0 || remainingUnsealed > 0) code = 1;
} catch (e) {
  console.error("webhook secret backfill failed:", e instanceof Error ? e.message : "unknown error");
  code = 1;
} finally {
  await client.end();
}
process.exit(code);
