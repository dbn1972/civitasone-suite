/**
 * One-shot, idempotent backfill that seals legacy DSC secrets in place
 * (P0: DSC passphrase / keystore plaintext). Driven by
 * scripts/backfill-dsc-secrets.mjs; kept in src/ so it is typechecked and
 * exercised by tests against a real Postgres.
 *
 * Why not a SQL migration: the AES key is app-held (PII_ENC_KEY), so SQL
 * cannot encrypt. Migration 0051 instead adds a NOT VALID CHECK so no NEW
 * plaintext row can be written; after this backfill reports
 * `remainingUnsealed: 0`, run `ALTER TABLE payroll.dsc_config VALIDATE
 * CONSTRAINT dsc_config_passphrase_sealed_chk;`.
 *
 * Per row:
 *   - passphrase not "enc:"-prefixed  -> seal it (compare-and-set on the old
 *     value, so a concurrent fresh upload is never clobbered);
 *   - keystore object not sealed      -> re-read it, and only if unchanged
 *     (no concurrent upload in between) seal it and write it back;
 *   - any value that ALREADY carries the "enc:" prefix is test-decrypted:
 *     a failure (wrong/missing key at rollout, or a legacy plaintext that
 *     happens to start with "enc:v2:") is reported in decryptErrors and the
 *     script exits 1.
 * Already-sealed rows/objects are untouched, so re-running is a no-op.
 *
 * Never logs or returns secret material — only counts and tenant ids.
 */
import { sql } from "drizzle-orm";
import { isSealed, isSealedP12, openDscPassphrase, openP12, sealDscPassphrase, sealP12 } from "./secret.js";

export interface DscBackfillRunner {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

export interface DscBackfillStorage {
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
}

export interface DscBackfillResult {
  scanned: number;
  passphrasesSealed: number;
  keystoresSealed: number;
  untouched: number;
  /** Rows whose keystore object could not be read (left as-is; re-run later). */
  keystoreErrors: Array<{ tenantId: string; error: string }>;
  /** Already-sealed values that do NOT decrypt with the configured keyring. */
  decryptErrors: Array<{ tenantId: string; field: "passphrase" | "keystore" }>;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

export async function backfillDscSecrets(
  runner: DscBackfillRunner,
  storage: DscBackfillStorage,
  opts: { onRowSealed?: (tenantId: string) => Promise<void> } = {},
): Promise<DscBackfillResult> {
  const result: DscBackfillResult = {
    scanned: 0, passphrasesSealed: 0, keystoresSealed: 0, untouched: 0, keystoreErrors: [], decryptErrors: [],
  };

  // Raw column read (not via the Drizzle table) so we see exactly what is stored.
  const rows = rowsOf(await runner.execute(sql`
    SELECT tenant_id::text AS tenant_id, passphrase, storage_ref FROM payroll.dsc_config
  `));

  for (const r of rows) {
    result.scanned++;
    const tenantId = String(r.tenant_id);
    const stored = String(r.passphrase);
    const storageRef = String(r.storage_ref);
    let changed = false;

    if (isSealed(stored)) {
      try { openDscPassphrase(stored); } catch {
        result.decryptErrors.push({ tenantId, field: "passphrase" });
      }
    } else {
      const sealed = sealDscPassphrase(stored);
      const updated = rowsOf(await runner.execute(sql`
        UPDATE payroll.dsc_config SET passphrase = ${sealed}
        WHERE tenant_id = ${tenantId}::uuid AND passphrase = ${stored}
        RETURNING tenant_id
      `));
      if (updated.length > 0) {
        result.passphrasesSealed++;
        changed = true;
      }
    }

    try {
      const blob = await storage.getObject(storageRef);
      if (isSealedP12(blob)) {
        try { openP12(blob); } catch {
          result.decryptErrors.push({ tenantId, field: "keystore" });
        }
      } else {
        // Narrow the read-then-write race with a concurrent DSC upload: the
        // storage helper has no conditional put, so re-read and only write
        // back if the object is still the exact legacy bytes we sealed.
        const sealedBlob = sealP12(blob);
        const again = await storage.getObject(storageRef);
        if (!again.equals(blob)) {
          result.keystoreErrors.push({ tenantId, error: "keystore changed concurrently; re-run the backfill" });
        } else {
          await storage.putObject(storageRef, sealedBlob, "application/octet-stream");
          result.keystoresSealed++;
          changed = true;
        }
      }
    } catch (e) {
      // Message only — never the object body.
      result.keystoreErrors.push({ tenantId, error: e instanceof Error ? e.message : "unknown error" });
    }

    if (changed) {
      if (opts.onRowSealed) await opts.onRowSealed(tenantId);
    } else {
      result.untouched++;
    }
  }

  return result;
}
