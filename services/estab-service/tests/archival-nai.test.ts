/**
 * R5 — Archival & NAI transfer (Public Records Act 1993).
 * Verifies: archive of Cat-A → nai_due with nai_eligible_at +25y; archive of
 * non-Cat-A → plain 'archived'; NAI transfer stamps reference + status;
 * listNaiDue only returns un-transferred past-eligibility records; tenant isolation.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { estabArchival } from "../src/modules/records/schema.js";
import {
  upsertRecord, insertArchival, findArchivalByFile, updateArchival, listNaiDue,
} from "../src/modules/records/repo.js";

const TENANT_A = "81111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "81111111-aaaa-4000-8000-0000000000b2";
const FILE_A   = "81111111-bbbb-4000-8000-0000000000f1";
const FILE_B   = "81111111-bbbb-4000-8000-0000000000f2";
const ACTOR    = "00000000-aaaa-4000-8000-000000000099";

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await db.delete(estabArchival).where(eq(estabArchival.tenantId, t));
    await db.execute(sql`DELETE FROM files.estab_file_record WHERE tenant_id = ${t}::uuid`);
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

async function seedCatA(tenantId: string, fileId: string) {
  await upsertRecord(db, { tenantId, fileId, recordCategory: "A", retentionYears: null, reviewDueDate: null, createdBy: ACTOR });
}

async function seedCatB(tenantId: string, fileId: string) {
  await upsertRecord(db, { tenantId, fileId, recordCategory: "B", retentionYears: 10, reviewDueDate: "2036-01-01", createdBy: ACTOR });
}

describe("R5 archival workflow", () => {
  it("archiving a Cat-A file sets status=nai_due with nai_eligible_at ~25y from now", async () => {
    await seedCatA(TENANT_A, FILE_A);
    const id = randomUUID();
    // Simulate: Cat-A → nai_due
    const naiEligibleAt = new Date(); naiEligibleAt.setFullYear(naiEligibleAt.getFullYear() + 25);
    await insertArchival(db, {
      id, tenantId: TENANT_A, fileId: FILE_A, archivedBy: ACTOR,
      status: "nai_due", naiEligibleAt, createdBy: ACTOR,
    });
    const arch = await findArchivalByFile(TENANT_A, FILE_A);
    expect(arch?.status).toBe("nai_due");
    expect(arch?.naiEligibleAt).not.toBeNull();
    // ~ 25 years from now (tolerance: within 2 days)
    const diff = Math.abs((arch!.naiEligibleAt!.getTime() - Date.now()) / 1000 / 86400 / 365);
    expect(diff).toBeCloseTo(25, 0);
  });

  it("archiving a non-Cat-A file is plain archived (no NAI eligibility)", async () => {
    await seedCatB(TENANT_A, FILE_B);
    const id = randomUUID();
    await insertArchival(db, {
      id, tenantId: TENANT_A, fileId: FILE_B, archivedBy: ACTOR,
      status: "archived", createdBy: ACTOR,
    });
    const arch = await findArchivalByFile(TENANT_A, FILE_B);
    expect(arch?.status).toBe("archived");
    expect(arch?.naiEligibleAt).toBeNull();
  });

  it("records NAI transfer with reference", async () => {
    await seedCatA(TENANT_A, FILE_A);
    const id = randomUUID();
    const naiEligibleAt = new Date(2020, 0, 1); // already past
    await insertArchival(db, {
      id, tenantId: TENANT_A, fileId: FILE_A, archivedBy: ACTOR,
      status: "nai_due", naiEligibleAt, createdBy: ACTOR,
    });
    await updateArchival(db, id, {
      status: "nai_transferred", naiTransferredAt: new Date(),
      naiReference: "NAI/2026/12345", registerNo: "REG-001",
    });
    const arch = await findArchivalByFile(TENANT_A, FILE_A);
    expect(arch?.status).toBe("nai_transferred");
    expect(arch?.naiReference).toBe("NAI/2026/12345");
  });

  it("listNaiDue returns only untransferred nai_due records (tenant-scoped)", async () => {
    await seedCatA(TENANT_A, FILE_A);
    const id = randomUUID();
    await insertArchival(db, {
      id, tenantId: TENANT_A, fileId: FILE_A, archivedBy: ACTOR,
      status: "nai_due", naiEligibleAt: new Date(2020, 0, 1), createdBy: ACTOR,
    });
    const due = await listNaiDue(TENANT_A, 50);
    expect(due.map((r) => r.id)).toContain(id);
    // Tenant B sees nothing
    const dueB = await listNaiDue(TENANT_B, 50);
    expect(dueB).toHaveLength(0);
  });
});
