/** CAP-036 — checklist template + instance gating over HTTP + DB. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c1050000-0000-4000-8000-000000000036";
const tok = (roles = ["case_manager"]) => signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s" }, SECRET);

afterEach(async () => {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.checklist_instances WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.checklist_templates WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

describe("CAP-036 checklist gating", () => {
  it("gate stays closed until all required items are checked", async () => {
    const app = await buildApp();
    const h = { authorization: `Bearer ${tok()}` };
    const tpl = await app.inject({ method: "PUT", url: "/v1/workflow/checklist-templates/intake", headers: h, payload: { name: "Intake", items: [
      { key: "id", label: "ID", required: true },
      { key: "fee", label: "Fee", required: true },
      { key: "note", label: "Note", required: false },
    ] } });
    const templateId = tpl.json().data.id;
    const inst = await app.inject({ method: "POST", url: "/v1/workflow/checklists", headers: h, payload: { templateId, entityType: "case", entityId: randomUUID() } });
    expect(inst.json().data.gate.open).toBe(false);
    const cid = inst.json().data.id;
    await app.inject({ method: "POST", url: `/v1/workflow/checklists/${cid}/items/id`, headers: h, payload: { checked: true } });
    const afterOne = await app.inject({ method: "POST", url: `/v1/workflow/checklists/${cid}/items/fee`, headers: h, payload: { checked: true } });
    expect(afterOne.json().data.gate.open).toBe(true);
    await app.close();
  });
});
