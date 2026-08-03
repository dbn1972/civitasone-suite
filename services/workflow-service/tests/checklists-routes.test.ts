/** CAP-036 — checklist CQRS route boundary (202 Accepted). */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerChecklistConsumers } from "../src/modules/checklists/consumer.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c1050000-0000-4000-8000-000000000036";
const tok = (roles = ["case_manager"]) => signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s" }, SECRET);

registerChecklistConsumers(queue);
await queue.start();

afterEach(async () => {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.checklist_instances WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.checklist_templates WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

describe("CAP-036 checklist gating", () => {
  it("accepts template/instance writes and opens gate after required toggles", async () => {
    const app = await buildApp();
    const h = { authorization: `Bearer ${tok()}` };
    const tpl = await app.inject({ method: "PUT", url: "/v1/workflow/checklist-templates/intake", headers: h, payload: { name: "Intake", items: [
      { key: "id", label: "ID", required: true },
      { key: "fee", label: "Fee", required: true },
      { key: "note", label: "Note", required: false },
    ] } });
    expect(tpl.statusCode).toBe(202);
    const templateId = tpl.json().id;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: "/v1/workflow/checklist-templates", headers: h });
      const rows = g.json().data as Array<{ id: string }>;
      return rows?.some((r) => r.id === templateId) ? rows : null;
    });
    const entityId = randomUUID();
    const inst = await app.inject({ method: "POST", url: "/v1/workflow/checklists", headers: h, payload: { templateId, entityType: "case", entityId } });
    expect(inst.statusCode).toBe(202);
    const cid = inst.json().id;
    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/workflow/checklists?entityType=case&entityId=${entityId}`, headers: h });
      const rows = g.json().data as Array<{ id: string; gate: { open: boolean } }>;
      return rows?.find((r) => r.id === cid) ?? null;
    });
    await app.inject({ method: "POST", url: `/v1/workflow/checklists/${cid}/items/id`, headers: h, payload: { checked: true } });
    await app.inject({ method: "POST", url: `/v1/workflow/checklists/${cid}/items/fee`, headers: h, payload: { checked: true } });
    const opened = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/workflow/checklists?entityType=case&entityId=${entityId}`, headers: h });
      const row = (g.json().data as Array<{ id: string; gate: { open: boolean } }>).find((r) => r.id === cid);
      return row?.gate.open ? row : null;
    });
    expect(opened.gate.open).toBe(true);
    await app.close();
  });
});
