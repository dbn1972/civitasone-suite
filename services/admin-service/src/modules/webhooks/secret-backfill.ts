/**
 * One-shot, idempotent backfill that seals legacy plaintext webhook HMAC
 * secrets in place (FQ12-SEC). Driven by scripts/backfill-webhook-secrets.mjs;
 * kept in src/ so it is typechecked and tested against a real Postgres.
 * Mirrors payroll-service's dsc-config/backfill.ts.
 *
 * Why not a SQL migration: the AES key is app-held (PII_ENC_KEY), so SQL
 * cannot encrypt.
 *
 * Columns: webhooks.webhooks.secret, webhooks.webhooks.previous_secret,
 * webhooks.secret_rotations.new_secret.
 *   - value without the "enc:v2:" envelope prefix -> seal it, compare-and-set
 *     on the old value so a concurrent write is never clobbered;
 *   - value already sealed -> test-decrypt only; a failure (wrong key at
 *     rollout) is reported in decryptErrors and the script exits 1.
 * Re-running is a no-op. Never logs or returns secret material: counts and
 * row ids only.
 *
 * The tables are FORCE RLS, so the runner must connect as a role that
 * bypasses RLS and can UPDATE them (the table owner / migration superuser).
 */
import { sql } from "drizzle-orm";
import { isSealed, openSecret, sealSecret } from "../../shared/secret-crypto.js";

export interface WebhookBackfillRunner {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

export interface WebhookBackfillResult {
  scanned: number;
  sealed: number;
  untouched: number;
  decryptErrors: Array<{ table: "webhooks" | "secret_rotations"; id: string; column: string }>;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

interface Target {
  table: "webhooks" | "secret_rotations";
  column: "secret" | "previous_secret" | "new_secret";
  select: ReturnType<typeof sql>;
  update: (id: string, from: string, to: string) => ReturnType<typeof sql>;
}

// Explicit statements per column (no dynamic identifiers).
const TARGETS: readonly Target[] = [
  {
    table: "webhooks", column: "secret",
    select: sql`SELECT id::text AS id, secret AS v FROM webhooks.webhooks`,
    update: (id, from, to) => sql`UPDATE webhooks.webhooks SET secret = ${to} WHERE id = ${id}::uuid AND secret = ${from} RETURNING id`,
  },
  {
    table: "webhooks", column: "previous_secret",
    select: sql`SELECT id::text AS id, previous_secret AS v FROM webhooks.webhooks WHERE previous_secret IS NOT NULL`,
    update: (id, from, to) => sql`UPDATE webhooks.webhooks SET previous_secret = ${to} WHERE id = ${id}::uuid AND previous_secret = ${from} RETURNING id`,
  },
  {
    table: "secret_rotations", column: "new_secret",
    select: sql`SELECT id::text AS id, new_secret AS v FROM webhooks.secret_rotations`,
    update: (id, from, to) => sql`UPDATE webhooks.secret_rotations SET new_secret = ${to} WHERE id = ${id}::uuid AND new_secret = ${from} RETURNING id`,
  },
];

export async function backfillWebhookSecrets(runner: WebhookBackfillRunner): Promise<WebhookBackfillResult> {
  const result: WebhookBackfillResult = { scanned: 0, sealed: 0, untouched: 0, decryptErrors: [] };

  for (const t of TARGETS) {
    const rows = rowsOf(await runner.execute(t.select));
    for (const r of rows) {
      result.scanned++;
      const id = String(r.id);
      const stored = String(r.v);
      if (isSealed(stored)) {
        try { openSecret(stored); } catch {
          result.decryptErrors.push({ table: t.table, id, column: t.column });
        }
        result.untouched++;
        continue;
      }
      const updated = rowsOf(await runner.execute(t.update(id, stored, sealSecret(stored))));
      if (updated.length > 0) result.sealed++;
      else result.untouched++;
    }
  }
  return result;
}

/** Count values still not sealed (the script's post-run assertion). */
export async function countUnsealedWebhookSecrets(runner: WebhookBackfillRunner): Promise<number> {
  const rows = rowsOf(await runner.execute(sql`
    SELECT
      (SELECT count(*) FROM webhooks.webhooks WHERE secret NOT LIKE 'enc:v2:%')
    + (SELECT count(*) FROM webhooks.webhooks WHERE previous_secret IS NOT NULL AND previous_secret NOT LIKE 'enc:v2:%')
    + (SELECT count(*) FROM webhooks.secret_rotations WHERE new_secret NOT LIKE 'enc:v2:%') AS remaining
  `));
  return Number(rows[0]?.remaining ?? 0);
}
