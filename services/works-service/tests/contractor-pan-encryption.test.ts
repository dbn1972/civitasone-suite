/**
 * SEC-011 regression test: contractor PAN encrypted at rest.
 *
 * Proves against a real Postgres connection (DATABASE_URL from vitest.config.ts):
 *  1. A contractor's `pan` is stored as AES-256-GCM ciphertext in the raw
 *     works.contractors column — queried directly via the postgres.js
 *     sqlClient, bypassing Drizzle's `encryptedText` customType entirely —
 *     and is not human-readable plaintext.
 *  2. Reading the same row back through the repo (which goes through the
 *     encryptedText type) transparently decrypts to the original PAN.
 *  3. A null pan is stored/read as null (no encryption attempted).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/contractor/repo.js";
import { resetPiiKeyCache, isEncrypted } from "../src/shared/pii-crypto.js";

const TENANT = "aaaaaaaa-3333-4000-8000-000000000099";

beforeAll(() => {
  process.env.PII_ENC_KEY = "test_pii_encryption_key_32chars!!";
  process.env.PII_KEY_ID = "k1";
  resetPiiKeyCache();
});

afterAll(async () => { await sqlClient.end(); });

async function rawPanFor(id: string): Promise<string | null> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return sql<{ pan: string | null }[]>`SELECT pan FROM works.contractors WHERE id = ${id}`;
  });
  return rows[0]?.pan ?? null;
}

describe("SEC-011 — contractor PAN encryption at rest", () => {
  it("stores pan as ciphertext in the raw column (not plaintext) and decrypts correctly via the repo", async () => {
    const id = randomUUID();
    const plainPan = "ABCDE1234F";

    await runWithTenant(TENANT, async () => {
      await db.transaction(async (tx) => {
        await repo.insertContractor(tx, {
          id, tenantId: TENANT, name: "SEC-011 Test Contractor",
          registrationNo: null, classId: null,
          pan: plainPan, gst: null, email: null, phone: null, address: null,
          active: true, createdBy: id, updatedBy: id,
        });
      });
    });

    // Raw column read via the postgres.js client — bypasses Drizzle's
    // encryptedText customType entirely, so this proves what is actually
    // on disk, not what the ORM layer hands back.
    const rawPan = await rawPanFor(id);
    expect(rawPan).not.toBeNull();
    expect(rawPan).not.toBe(plainPan);
    expect(rawPan!).not.toContain(plainPan);
    expect(isEncrypted(rawPan!)).toBe(true);
    expect(rawPan!.startsWith("enc:v2:")).toBe(true);

    // Repo read goes back through the encryptedText customType and must
    // transparently decrypt to the original PAN.
    const found = await runWithTenant(TENANT, () => repo.findContractorById(TENANT, id));
    expect(found).not.toBeNull();
    expect(found!.pan).toBe(plainPan);
  });

  it("round-trips a null pan without attempting to encrypt it", async () => {
    const id = randomUUID();

    await runWithTenant(TENANT, async () => {
      await db.transaction(async (tx) => {
        await repo.insertContractor(tx, {
          id, tenantId: TENANT, name: "SEC-011 Null PAN Contractor",
          registrationNo: null, classId: null,
          pan: null, gst: null, email: null, phone: null, address: null,
          active: true, createdBy: id, updatedBy: id,
        });
      });
    });

    expect(await rawPanFor(id)).toBeNull();
    const found = await runWithTenant(TENANT, () => repo.findContractorById(TENANT, id));
    expect(found!.pan).toBeNull();
  });

  it("two contractors with the same PAN get different ciphertext (random IV per write)", async () => {
    const idA = randomUUID();
    const idB = randomUUID();
    const plainPan = "PQRST5678G";

    await runWithTenant(TENANT, async () => {
      await db.transaction(async (tx) => {
        await repo.insertContractor(tx, {
          id: idA, tenantId: TENANT, name: "SEC-011 Dup PAN A",
          registrationNo: null, classId: null,
          pan: plainPan, gst: null, email: null, phone: null, address: null,
          active: true, createdBy: idA, updatedBy: idA,
        });
        await repo.insertContractor(tx, {
          id: idB, tenantId: TENANT, name: "SEC-011 Dup PAN B",
          registrationNo: null, classId: null,
          pan: plainPan, gst: null, email: null, phone: null, address: null,
          active: true, createdBy: idB, updatedBy: idB,
        });
      });
    });

    const [rawA, rawB] = await Promise.all([rawPanFor(idA), rawPanFor(idB)]);
    expect(rawA).not.toBe(rawB);

    const [foundA, foundB] = await runWithTenant(TENANT, () =>
      Promise.all([repo.findContractorById(TENANT, idA), repo.findContractorById(TENANT, idB)]),
    );
    expect(foundA!.pan).toBe(plainPan);
    expect(foundB!.pan).toBe(plainPan);
  });
});
