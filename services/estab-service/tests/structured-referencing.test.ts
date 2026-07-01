/**
 * R7 — Structured referencing (CSMOP "Referencing").
 * Verifies: add each ref_type, list by file, list by note, delete,
 * invalid type rejected, tenant isolation.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { estabReference } from "../src/modules/referencing/schema.js";
import { insertReference, listReferencesByFile, listReferencesByNote, deleteReference } from "../src/modules/referencing/repo.js";
import { REFERENCE_TYPES, isReferenceType } from "../src/modules/referencing/domain.js";

const TENANT_A = "91111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "91111111-aaaa-4000-8000-0000000000b2";
const FILE_A   = "91111111-bbbb-4000-8000-0000000000f1";
const NOTE_A   = "91111111-cccc-4000-8000-000000000001";
const ACTOR    = "00000000-aaaa-4000-8000-0000000000e1";

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await db.delete(estabReference).where(eq(estabReference.tenantId, t));
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("R7 structured referencing", () => {
  it("accepts all 7 reference types", () => {
    expect(REFERENCE_TYPES.length).toBe(7);
    for (const t of REFERENCE_TYPES) expect(isReferenceType(t)).toBe(true);
    expect(isReferenceType("nonsense")).toBe(false);
  });

  it("inserts and lists references by file", async () => {
    const id = randomUUID();
    await insertReference(db, {
      id, tenantId: TENANT_A, fileId: FILE_A, noteId: NOTE_A,
      refType: "rule", refValue: "GFR Rule 21(3)", label: "GFR limit",
      createdBy: ACTOR,
    });
    const refs = await listReferencesByFile(TENANT_A, FILE_A);
    expect(refs.map((r) => r.id)).toContain(id);
    expect(refs[0]?.refType).toBe("rule");
    expect(refs[0]?.refValue).toContain("GFR");
  });

  it("lists references by note id", async () => {
    const id = randomUUID();
    await insertReference(db, {
      id, tenantId: TENANT_A, fileId: FILE_A, noteId: NOTE_A,
      refType: "concurrence", refValue: "Finance concurrence dt. 12/03/2026",
      createdBy: ACTOR,
    });
    const refs = await listReferencesByNote(TENANT_A, NOTE_A);
    expect(refs.map((r) => r.id)).toContain(id);
  });

  it("deletes a reference (stable removal)", async () => {
    const id = randomUUID();
    await insertReference(db, {
      id, tenantId: TENANT_A, fileId: FILE_A, refType: "annexure", refValue: "Annexure-I", createdBy: ACTOR,
    });
    await deleteReference(db, id, TENANT_A);
    const refs = await listReferencesByFile(TENANT_A, FILE_A);
    expect(refs.map((r) => r.id)).not.toContain(id);
  });

  it("is tenant-scoped (tenant B cannot see tenant A references)", async () => {
    await insertReference(db, {
      id: randomUUID(), tenantId: TENANT_A, fileId: FILE_A, refType: "puc", refValue: "PUC at page 3", createdBy: ACTOR,
    });
    const fromB = await listReferencesByFile(TENANT_B, FILE_A);
    expect(fromB).toHaveLength(0);
  });
});
