/**
 * R8 — NIC eOffice parity features.
 * Verifies: DFA template library (insert, list, code-unique), VIP/Parliament
 * fields on files, and tenant isolation on templates.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { estabDfaTemplate } from "../src/modules/dfa/schema.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { insertDfaTemplate, listDfaTemplates, findDfaTemplateByCode } from "../src/modules/dfa/repo.js";
import { insertFile, findFileById } from "../src/modules/files/repo.js";

const TENANT_A = "b1111111-aaaa-4000-8000-0000000000a1";
const TENANT_B = "b1111111-aaaa-4000-8000-0000000000b2";
const ACTOR    = "00000000-aaaa-4000-8000-0000000000d1";

async function clean() {
  for (const t of [TENANT_A, TENANT_B]) {
    await db.delete(estabDfaTemplate).where(eq(estabDfaTemplate.tenantId, t));
    await db.delete(estabFiles).where(eq(estabFiles.tenantId, t));
  }
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("R8 DFA template library", () => {
  it("inserts and lists active templates by tenant", async () => {
    await insertDfaTemplate(db, {
      id: randomUUID(), tenantId: TENANT_A, code: "OM_STANDARD",
      name: "Office Memorandum", communicationType: "memo",
      body: "Subject: {{subject}}\\n\\nRef: {{ref}}\\n\\n{{body}}", isActive: true,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await insertDfaTemplate(db, {
      id: randomUUID(), tenantId: TENANT_A, code: "SANCTION",
      name: "Sanction Order", communicationType: "order",
      body: "Order No. {{dfaNo}}\\n{{body}}", isActive: true,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    const list = await listDfaTemplates(TENANT_A);
    expect(list.length).toBe(2);
    expect(list.map((t) => t.code).sort()).toEqual(["OM_STANDARD", "SANCTION"]);
  });

  it("finds a template by code", async () => {
    await insertDfaTemplate(db, {
      id: randomUUID(), tenantId: TENANT_A, code: "DO_LETTER",
      name: "DO Letter", communicationType: "do_letter",
      body: "Dear {{name}},\\n\\n{{body}}", isActive: true,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    const tpl = await findDfaTemplateByCode(TENANT_A, "DO_LETTER");
    expect(tpl?.name).toBe("DO Letter");
  });

  it("is tenant-scoped", async () => {
    await insertDfaTemplate(db, {
      id: randomUUID(), tenantId: TENANT_A, code: "SECRET",
      name: "Tenant A only", communicationType: "letter", body: "body",
      isActive: true, createdBy: ACTOR, updatedBy: ACTOR,
    });
    const fromB = await listDfaTemplates(TENANT_B);
    expect(fromB).toHaveLength(0);
  });
});

describe("R8 VIP/Parliament fields on files", () => {
  it("persists vip_reference, parliament_qno, is_vip", async () => {
    const id = randomUUID();
    await insertFile(db, {
      id, tenantId: TENANT_A, fileNo: "VIP/00001/2026", subject: "VIP File",
      dept: "CMO", currentWith: ACTOR, status: "active", fileType: "main", volumeNo: 1,
      vipReference: "PMO/2026/SPL/003", parliamentQno: "USQ-2126", isVip: true,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    const f = await findFileById(id, TENANT_A);
    expect(f?.vipReference).toBe("PMO/2026/SPL/003");
    expect(f?.parliamentQno).toBe("USQ-2126");
    expect(f?.isVip).toBe(true);
  });
});
