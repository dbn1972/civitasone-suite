/**
 * GAP-WORKFLOW-LIST-03 — the instances LIST endpoint must carry the subject
 * (refType/refId), definition name/code, current step and dates (not just the
 * slim id/name/status/version the old projection returned, which forced a raw
 * UUID name fallback and told the user nothing about what/where/how old).
 *
 * GAP-WORKFLOW-MY-TASKS-05 — the task list view must expose createdAt (age) and
 * dueAt (SLA/overdue) so the inbox can sort oldest/most-overdue first.
 *
 * DB-backed, following tests/instances-detail.test.ts's harness exactly.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { instances } from "../src/modules/instances/schema.js";
import { tasks } from "../src/modules/tasks/schema.js";
import { definitions } from "../src/modules/definitions/schema.js";
import { asTenant, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

function makeToken(tenantId: string, roles: string[] = ["workflow_admin"], sub = "user-001") {
  return signToken({ sub, tid: tenantId, roles, sid: "sess-list03" }, SECRET);
}

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => {
  if (tenants.length) { await cleanup(...tenants); tenants.length = 0; }
});
afterAll(async () => { await sqlClient.end(); });

async function seedDefinitionRow(tenantId: string, actorId: string, code: string, name: string): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(definitions).values({
      id, tenantId, code, name, version: 1, status: "active", isTemplate: false,
      createdBy: actorId, updatedBy: actorId,
    });
  }));
  return id;
}

async function seedInstance(tenantId: string, actorId: string, opts: {
  name?: string; status?: string; definitionId?: string; definitionVersion?: number;
  refType?: string; refId?: string; currentNode?: string;
} = {}): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(instances).values({
      id, tenantId,
      name: opts.name ?? "List Test Instance",
      status: opts.status ?? "active",
      definitionId: opts.definitionId ?? null,
      definitionVersion: opts.definitionVersion ?? null,
      refType: opts.refType ?? null,
      refId: opts.refId ?? null,
      currentNode: opts.currentNode ?? null,
      createdBy: actorId, updatedBy: actorId, version: 1,
    });
  }));
  return id;
}

describe("GET /v1/workflow/instances (enriched list) — GAP-WORKFLOW-LIST-03", () => {
  it("returns definitionName/code, refType/refId, currentNode and createdAt for each row", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const defId = await seedDefinitionRow(tenantId, actorId, `code_${randomUUID().slice(0, 6)}`, "Leave Approval");
    const refId = randomUUID();
    const id = await seedInstance(tenantId, actorId, {
      name: "Leave #42", definitionId: defId, definitionVersion: 1,
      refType: "leave_app", refId, currentNode: "manager_review",
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/instances",
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const row = res.json().data.find((r: { id: string }) => r.id === id);
    expect(row).toBeTruthy();
    expect(row.definitionName).toBe("Leave Approval");
    expect(row.refType).toBe("leave_app");
    expect(row.refId).toBe(refId);
    expect(row.currentNode).toBe("manager_review");
    expect(typeof row.createdAt).toBe("string");
    expect(row.definitionCode).toBeTruthy();
  });

  it("orders rows by createdAt descending (newest first)", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const first = await seedInstance(tenantId, actorId, { name: "First" });
    // Ensure a strictly later created_at for the second row.
    await new Promise((r) => setTimeout(r, 20));
    const second = await seedInstance(tenantId, actorId, { name: "Second" });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/instances",
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    const ids = res.json().data.map((r: { id: string }) => r.id);
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first));
  });
});

describe("GET /v1/workflow/tasks — createdAt + dueAt (GAP-WORKFLOW-MY-TASKS-05)", () => {
  it("exposes createdAt and dueAt on each task row", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const instanceId = await seedInstance(tenantId, actorId);
    const due = new Date(Date.now() + 3_600_000);
    const taskId = randomUUID();
    await asTenant(tenantId, () => db.transaction(async (tx) => {
      await tx.insert(tasks).values({
        id: taskId, tenantId, instanceId, name: "Review", status: "pending",
        dueAt: due, createdBy: actorId, updatedBy: actorId, version: 1,
      });
    }));

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks?instanceId=${instanceId}`,
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const row = res.json().data.find((t: { id: string }) => t.id === taskId);
    expect(row).toBeTruthy();
    expect(typeof row.createdAt).toBe("string");
    expect(typeof row.dueAt).toBe("string");
  });
});
