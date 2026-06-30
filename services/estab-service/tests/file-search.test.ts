/**
 * CSMOP full-text file search — GIN tsvector over file subject/number/dept and
 * note-sheet content, tenant-scoped and ranked. Verifies matching, note-content
 * matching, and strict tenant isolation.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles, estabNotings } from "../src/modules/files/schema.js";
import { searchFiles } from "../src/modules/files/repo.js";

const TENANT_A = "21111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "21111111-aaaa-4000-8000-0000000000b2";
const ACTOR    = "00000000-aaaa-4000-8000-0000000000c3";

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await db.execute((await import("drizzle-orm")).sql`UPDATE files.estab_notings SET note_status='draft' WHERE tenant_id=${t}`);
    await db.delete(estabNotings).where(eq(estabNotings.tenantId, t));
    await db.delete(estabFiles).where(eq(estabFiles.tenantId, t));
  }
}

async function seedFile(tenantId: string, opts: { subject: string; fileNo: string; dept?: string; note?: string }) {
  const id = randomUUID();
  await db.insert(estabFiles).values({
    id, tenantId, fileNo: opts.fileNo, subject: opts.subject, dept: opts.dept ?? "ESTAB",
    currentWith: ACTOR, status: "active", createdBy: ACTOR, updatedBy: ACTOR,
  });
  if (opts.note) {
    await db.insert(estabNotings).values({
      id: randomUUID(), tenantId, fileId: id, seq: 1, officerId: ACTOR, body: opts.note,
      noteType: "green", noteStatus: "submitted", eSigned: false, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }
  return id;
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("CSMOP full-text file search", () => {
  it("matches files by subject term, ranked", async () => {
    const wanted = await seedFile(TENANT_A, { subject: "Pay revision of Group B officers", fileNo: "ESTAB-A/00001/2026" });
    await seedFile(TENANT_A, { subject: "Office vehicle maintenance contract", fileNo: "ESTAB-A/00002/2026" });
    const hits = await searchFiles(TENANT_A, "pay revision", 25);
    expect(hits.map((h) => h.id)).toContain(wanted);
    expect(hits[0]?.matchedIn).toBe("file");
  });

  it("matches files by note-sheet content", async () => {
    const wanted = await seedFile(TENANT_A, {
      subject: "Miscellaneous establishment matter", fileNo: "ESTAB-A/00003/2026",
      note: "Approved disbursement of leave travel concession arrears.",
    });
    const hits = await searchFiles(TENANT_A, "travel concession", 25);
    expect(hits.map((h) => h.id)).toContain(wanted);
  });

  it("is strictly tenant-scoped (no cross-tenant leakage)", async () => {
    await seedFile(TENANT_B, { subject: "Pay revision secret tenant B file", fileNo: "ESTAB-B/00001/2026" });
    const hits = await searchFiles(TENANT_A, "pay revision secret tenant", 25);
    expect(hits).toHaveLength(0);
  });
});
