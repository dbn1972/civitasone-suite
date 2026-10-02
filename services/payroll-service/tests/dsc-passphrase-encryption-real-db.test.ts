/**
 * P0 security — DSC passphrase at rest, against a REAL Postgres (no db/outbox
 * mocks). Requires DATABASE_URL pointing at your own disposable, migrated
 * (through 0051) payroll database — see vitest.config.ts REL-035.
 *
 * Proves:
 *  - the consumer stores a SEALED value (raw column read, not via the Drizzle
 *    table) for both current (passphraseSealed) and legacy in-flight
 *    (plaintext `passphrase`) messages;
 *  - migration 0051's CHECK refuses a new plaintext passphrase;
 *  - backfillDscSecrets() seals a legacy plaintext row + raw keystore object,
 *    is idempotent, and the sealed result still opens to the original values.
 *
 * Tenant scoping: payroll.dsc_config is FORCE RLS; reads/writes go through
 * withTenantScope and publishes are wrapped in runWithTenant, mirroring
 * worker.ts (same harness as fnf-settlements-unique-real-db.test.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerDscConfigConsumers } from "../src/modules/dsc-config/consumer.js";
import { backfillDscSecrets } from "../src/modules/dsc-config/backfill.js";
import {
  isSealed, isSealedP12, openDscPassphrase, openP12, sealDscPassphrase,
} from "../src/modules/dsc-config/secret.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR = "60000000-ffff-4000-8000-0000000000d5";
// Test-only dummy passphrase; asserted to never appear in the stored column.
const PASS = "real-db-dsc-passphrase-must-not-be-stored"; // gitleaks:allow

type TxRunner = { execute: (q: unknown) => Promise<unknown> };
const rowsOf = (r: unknown) => Array.from(r as Iterable<Record<string, unknown>>);

function upsertPayload(tenantId: string, secret: Record<string, string>) {
  return {
    id: randomUUID(), tenantId, storageRef: `dsc/${tenantId}/signing.p12`, ...secret,
    subjectCn: "CN=Real DB", serialNumber: "0D5C", notBefore: "2025-01-01T00:00:00Z",
    notAfter: "2099-01-01T00:00:00Z", sha256Fingerprint: "ab", reason: null,
  };
}

async function publishScoped(tenantId: string, payload: Record<string, unknown>): Promise<void> {
  const q = new MemoryQueue();
  registerDscConfigConsumers(q);
  await q.start();
  try {
    await runWithTenant(tenantId, async () => {
      await q.publish(COMMANDS.dscConfigUpsert, {
        messageId: randomUUID(), type: COMMANDS.dscConfigUpsert, tenantId, actorId: ACTOR,
        correlationId: randomUUID(), schemaVersion: "1.0", payload,
      });
    });
    // MemoryQueue delivers asynchronously; poll for the consumer commit
    // (a cold first connection can exceed a fixed sleep).
    for (let i = 0; i < 50 && (await rawPassphrase(tenantId)) === undefined; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    await q.stop();
  }
}

async function rawPassphrase(tenantId: string): Promise<string | undefined> {
  return withTenantScope(db as never, tenantId, async (tx: TxRunner) => {
    const rows = rowsOf(await tx.execute(sql`SELECT passphrase FROM payroll.dsc_config WHERE tenant_id = ${tenantId}::uuid`));
    return rows[0]?.passphrase as string | undefined;
  });
}

const created: string[] = [];
afterAll(async () => {
  for (const t of created) {
    await withTenantScope(db as never, t, async (tx: TxRunner) => {
      await tx.execute(sql`DELETE FROM payroll.dsc_config WHERE tenant_id = ${t}::uuid`);
    });
  }
  await sqlClient.end();
});

describe("payroll.dsc_config passphrase at rest — real Postgres", () => {
  it("consumer stores a sealed value, never the plaintext", async () => {
    const t = randomUUID(); created.push(t);
    await publishScoped(t, upsertPayload(t, { passphraseSealed: sealDscPassphrase(PASS) }));
    const stored = await rawPassphrase(t);
    expect(stored).toBeDefined();
    expect(stored).not.toContain(PASS);
    expect(isSealed(stored!)).toBe(true);
    expect(openDscPassphrase(stored!)).toBe(PASS);
  });

  it("a legacy in-flight message with a plaintext passphrase is sealed before it is stored", async () => {
    const t = randomUUID(); created.push(t);
    await publishScoped(t, upsertPayload(t, { passphrase: PASS }));
    const stored = await rawPassphrase(t);
    expect(stored).toBeDefined();
    expect(stored).not.toContain(PASS);
    expect(openDscPassphrase(stored!)).toBe(PASS);
  });

  it("migration 0051 CHECK refuses a new plaintext passphrase", async () => {
    const t = randomUUID();
    await expect(withTenantScope(db as never, t, async (tx: TxRunner) => {
      await tx.execute(sql`
        INSERT INTO payroll.dsc_config (tenant_id, storage_ref, passphrase, subject_cn, serial_number,
          not_before, not_after, sha256_fingerprint, created_by, updated_by)
        VALUES (${t}::uuid, 'dsc/x', ${PASS}, 'CN', 'SN', now(), now(), 'fp', ${ACTOR}::uuid, ${ACTOR}::uuid)
      `);
    })).rejects.toThrow(/dsc_config_passphrase_sealed_chk/);
  });

  it("backfill seals a legacy plaintext row + raw keystore object, idempotently", async () => {
    const t = randomUUID(); created.push(t);
    const rawP12 = Buffer.from([0x30, 0x82, 0x09, 0x10, 1, 2, 3, 4, 5, 6, 7, 8]);
    const objects = new Map<string, Buffer>([[`dsc/${t}/signing.p12`, rawP12]]);
    const storage = {
      getObject: async (k: string) => {
        const b = objects.get(k);
        if (!b) throw new Error(`no object ${k}`);
        return b;
      },
      putObject: async (k: string, b: Buffer) => { objects.set(k, b); },
    };

    // Simulate a row that predates migration 0051 (the NOT VALID CHECK still
    // applies to new writes, so lift it for this one insert, atomically).
    await withTenantScope(db as never, t, async (tx: TxRunner) => {
      await tx.execute(sql`ALTER TABLE payroll.dsc_config DROP CONSTRAINT dsc_config_passphrase_sealed_chk`);
      await tx.execute(sql`
        INSERT INTO payroll.dsc_config (tenant_id, storage_ref, passphrase, subject_cn, serial_number,
          not_before, not_after, sha256_fingerprint, created_by, updated_by)
        VALUES (${t}::uuid, ${`dsc/${t}/signing.p12`}, ${PASS}, 'CN', 'SN', now(), now(), 'fp', ${ACTOR}::uuid, ${ACTOR}::uuid)
      `);
      await tx.execute(sql`
        ALTER TABLE payroll.dsc_config ADD CONSTRAINT dsc_config_passphrase_sealed_chk
        CHECK (passphrase LIKE 'enc:v1:%' OR passphrase LIKE 'enc:v2:%') NOT VALID
      `);
    });
    expect(await rawPassphrase(t)).toBe(PASS);

    const touched: string[] = [];
    const first = await withTenantScope(db as never, t, (tx: TxRunner) =>
      backfillDscSecrets(tx as never, storage, { onRowSealed: async (id) => { touched.push(id); } }));
    expect(first).toMatchObject({ scanned: 1, passphrasesSealed: 1, keystoresSealed: 1, untouched: 0 });
    expect(first.keystoreErrors).toEqual([]);
    expect(first.decryptErrors).toEqual([]);
    expect(touched).toEqual([t]);

    const stored = await rawPassphrase(t);
    expect(stored).not.toContain(PASS);
    expect(openDscPassphrase(stored!)).toBe(PASS);
    const obj = objects.get(`dsc/${t}/signing.p12`)!;
    expect(isSealedP12(obj)).toBe(true);
    expect(openP12(obj).equals(rawP12)).toBe(true);

    // Idempotent: second run changes nothing.
    const second = await withTenantScope(db as never, t, (tx: TxRunner) => backfillDscSecrets(tx as never, storage));
    expect(second).toMatchObject({ scanned: 1, passphrasesSealed: 0, keystoresSealed: 0, untouched: 1 });
    expect(await rawPassphrase(t)).toBe(stored);
  });

  it("backfill test-decrypts already-sealed values and reports ones the keyring cannot open", async () => {
    const t = randomUUID(); created.push(t);
    // Passes the 0051 CHECK (has the prefix) but is not a valid envelope for
    // this keyring: models a wrong key at rollout, or a legacy plaintext that
    // happens to start with "enc:v2:".
    const bogus = "enc:v2:k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    await withTenantScope(db as never, t, async (tx: TxRunner) => {
      await tx.execute(sql`
        INSERT INTO payroll.dsc_config (tenant_id, storage_ref, passphrase, subject_cn, serial_number,
          not_before, not_after, sha256_fingerprint, created_by, updated_by)
        VALUES (${t}::uuid, ${`dsc/${t}/signing.p12`}, ${bogus}, 'CN', 'SN', now(), now(), 'fp', ${ACTOR}::uuid, ${ACTOR}::uuid)
      `);
    });
    const storage = {
      getObject: async () => Buffer.from("enc:v2:k1:not-a-valid-envelope", "utf8"),
      putObject: async () => { throw new Error("must not write"); },
    };
    const res = await withTenantScope(db as never, t, (tx: TxRunner) => backfillDscSecrets(tx as never, storage));
    expect(res.decryptErrors).toEqual([
      { tenantId: t, field: "passphrase" },
      { tenantId: t, field: "keystore" },
    ]);
    expect(res.passphrasesSealed).toBe(0);
    expect(await rawPassphrase(t)).toBe(bogus); // left untouched for a human
  });

  it("backfill does not overwrite a keystore that changed between read and write", async () => {
    const t = randomUUID(); created.push(t);
    await withTenantScope(db as never, t, async (tx: TxRunner) => {
      await tx.execute(sql`
        INSERT INTO payroll.dsc_config (tenant_id, storage_ref, passphrase, subject_cn, serial_number,
          not_before, not_after, sha256_fingerprint, created_by, updated_by)
        VALUES (${t}::uuid, ${`dsc/${t}/signing.p12`}, ${sealDscPassphrase(PASS)}, 'CN', 'SN', now(), now(), 'fp', ${ACTOR}::uuid, ${ACTOR}::uuid)
      `);
    });
    let reads = 0;
    const writes: Buffer[] = [];
    const storage = {
      // 1st read: legacy raw DER; 2nd read: a concurrent upload replaced it.
      getObject: async () => (reads++ === 0
        ? Buffer.from([0x30, 0x82, 0x01, 0x01, 9, 9])
        : Buffer.from([0x30, 0x82, 0x02, 0x02, 7, 7])),
      putObject: async (_k: string, b: Buffer) => { writes.push(b); },
    };
    const res = await withTenantScope(db as never, t, (tx: TxRunner) => backfillDscSecrets(tx as never, storage));
    expect(writes).toHaveLength(0);
    expect(res.keystoresSealed).toBe(0);
    expect(res.keystoreErrors).toEqual([{ tenantId: t, error: "keystore changed concurrently; re-run the backfill" }]);
  });
});
