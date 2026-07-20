/**
 * R3 — DFA hardening. Verifies the DFA number is gapless (allocated atomically
 * from files.estab_doc_seq, never Math.random()) and that draft revisions are
 * retained in estab_dfa_version, tenant-scoped.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabDfa, estabDfaVersion } from "../src/modules/dfa/schema.js";
import {
  allocateDfaSeq, insertDfa, insertDfaVersion, nextDfaRevNo, listDfaVersions,
} from "../src/modules/dfa/repo.js";
import { formatDfaNo } from "../src/modules/dfa/domain.js";

const TENANT_A = "31111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "31111111-aaaa-4000-8000-0000000000b2";
const ACTOR    = "00000000-bbbb-4000-8000-0000000000c3";
const YEAR     = 2026;

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(estabDfaVersion).where(eq(estabDfaVersion.tenantId, t));
        await tx.delete(estabDfa).where(eq(estabDfa.tenantId, t));
        await tx.execute(sql`DELETE FROM files.estab_doc_seq WHERE tenant_id=${t}::uuid AND series LIKE 'dfa:%'`);
      }),
    );
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("R3 gapless DFA numbering", () => {
  it("allocates consecutive serials per (tenant, type, year) with no gaps", async () => {
    const a = await runWithTenant(TENANT_A, () => db.transaction((tx) => allocateDfaSeq(tx, TENANT_A, "letter", YEAR)));
    const b = await runWithTenant(TENANT_A, () => db.transaction((tx) => allocateDfaSeq(tx, TENANT_A, "letter", YEAR)));
    const c = await runWithTenant(TENANT_A, () => db.transaction((tx) => allocateDfaSeq(tx, TENANT_A, "letter", YEAR)));
    expect([a, b, c]).toEqual([1, 2, 3]);
    expect(formatDfaNo("letter", YEAR, a)).toBe("DFA/LET/2026/00001");
  });

  it("keeps separate series per communication type", async () => {
    const letter = await runWithTenant(TENANT_A, () => db.transaction((tx) => allocateDfaSeq(tx, TENANT_A, "letter", YEAR)));
    const order  = await runWithTenant(TENANT_A, () => db.transaction((tx) => allocateDfaSeq(tx, TENANT_A, "order", YEAR)));
    expect(letter).toBe(1);
    expect(order).toBe(1); // independent series
  });

  it("isolates sequences per tenant", async () => {
    await runWithTenant(TENANT_A, () => db.transaction((tx) => allocateDfaSeq(tx, TENANT_A, "memo", YEAR)));
    await runWithTenant(TENANT_A, () => db.transaction((tx) => allocateDfaSeq(tx, TENANT_A, "memo", YEAR)));
    const bFirst = await runWithTenant(TENANT_B, () => db.transaction((tx) => allocateDfaSeq(tx, TENANT_B, "memo", YEAR)));
    expect(bFirst).toBe(1); // tenant B starts fresh
  });
});

describe("R3 DFA draft versioning", () => {
  async function seedDfa(tenantId: string, id: string) {
    await runWithTenant(tenantId, () =>
      db.transaction((tx) =>
        insertDfa(tx, {
          id, tenantId, dfaNo: formatDfaNo("letter", YEAR, 1),
          fileId: null, communicationType: "letter", templateCode: null,
          subject: "Initial subject", body: "Initial body",
          recipientEmployeeId: null, recipientName: null, recipientAddress: null,
          status: "draft", createdBy: ACTOR, updatedBy: ACTOR,
        }),
      ),
    );
  }

  it("retains every revision with a comment, ordered by revNo", async () => {
    const id = randomUUID();
    await seedDfa(TENANT_A, id);
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => insertDfaVersion(tx, { tenantId: TENANT_A, dfaId: id, revNo: 1, subject: "Initial subject", body: "Initial body", comment: "initial draft", createdBy: ACTOR })),
    );

    const rev2 = await runWithTenant(TENANT_A, () => db.transaction((tx) => nextDfaRevNo(tx, id)));
    expect(rev2).toBe(2);
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => insertDfaVersion(tx, { tenantId: TENANT_A, dfaId: id, revNo: rev2, subject: "Initial subject", body: "Revised body", comment: "revision", createdBy: ACTOR })),
    );

    const rev3 = await runWithTenant(TENANT_A, () => db.transaction((tx) => nextDfaRevNo(tx, id)));
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => insertDfaVersion(tx, { tenantId: TENANT_A, dfaId: id, revNo: rev3, subject: "Initial subject", body: "Revised body", comment: "returned: please cite GFR rule", createdBy: ACTOR })),
    );

    const versions = await runWithTenant(TENANT_A, () => listDfaVersions(id, TENANT_A));
    expect(versions.map((v) => v.revNo)).toEqual([1, 2, 3]);
    expect(versions[1]?.body).toBe("Revised body");
    expect(versions[2]?.comment).toContain("returned:");
  });

  it("scopes version history to the owning tenant", async () => {
    const id = randomUUID();
    await seedDfa(TENANT_A, id);
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => insertDfaVersion(tx, { tenantId: TENANT_A, dfaId: id, revNo: 1, subject: "s", body: "b", comment: "c", createdBy: ACTOR })),
    );
    const fromB = await runWithTenant(TENANT_B, () => listDfaVersions(id, TENANT_B));
    expect(fromB).toHaveLength(0);
  });
});
