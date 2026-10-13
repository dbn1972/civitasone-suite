/**
 * GAP-WORKFLOW-INSTANCES-DETAIL-02 (docs/gap-closure/w0-report.md, F4) — the
 * server refuses to APPROVE an application-bound officer task while the lane
 * checklist has missing mandatory documents (or cannot be read: fail closed),
 * audits the refusal, and re-checks in the consumer. Reject / return and
 * non-application tasks are never gated.
 */
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { registerInstancesConsumers } from "../src/modules/instances/consumer.js";
import { registerTasksConsumers } from "../src/modules/tasks/consumer.js";
import { completeTask } from "../src/modules/tasks/commands.js";
import { checkMandatoryDocs, isDocGatedTask } from "../src/modules/tasks/doc-gate.js";
import { COMMANDS } from "../src/topics.js";
import { TestQueue, seedDefinition, cleanup, sqlAsTenant, asTenant } from "./helpers/engine-harness.js";
import type { RequestContext } from "@civitasone/types";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

/**
 * The shipped CHECK constraints (migration 0024) list only the refTypes with a
 * live producer, and no workflow producer for citizen applications exists yet,
 * so a real `application` task cannot be inserted. The web checklist (FN-26)
 * and this gate key off such a refType, so — on the DISPOSABLE test database
 * only — widen the two constraints to also admit "application" (superset; the
 * production migration is deliberately NOT changed by this fix).
 */
async function admitApplicationRefType(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL as string);
  url.username = process.env.TEST_ADMIN_DB_USER ?? "civitas";
  url.password = process.env.TEST_ADMIN_DB_PASSWORD ?? "civitas_test";
  const admin = postgres(url.toString(), { max: 1 });
  try {
    for (const [table, name] of [["instances", "instances_ref_type_check"], ["tasks", "tasks_ref_type_check"]] as const) {
      await admin.unsafe(`ALTER TABLE workflow.${table} DROP CONSTRAINT IF EXISTS ${name}`);
      await admin.unsafe(
        `ALTER TABLE workflow.${table} ADD CONSTRAINT ${name} CHECK (ref_type IS NULL OR ref_type IN ` +
        `('leave_app','payroll_run','procurement_indent','procurement_po','estab_file','asset_disposal','application'))`,
      );
    }
  } finally {
    await admin.end();
  }
}

let q: TestQueue;
beforeAll(async () => {
  await admitApplicationRefType();
  q = new TestQueue();
  registerInstancesConsumers(q);
  registerTasksConsumers(q);
});
beforeEach(() => { process.env.INTERNAL_SERVICE_SECRET = "doc-gate-test-secret-0123456789"; });
afterEach(async () => {
  vi.restoreAllMocks();
  if (tenants.length) { await cleanup(...tenants); tenants.length = 0; }
});
afterAll(async () => { await sqlClient.end(); });

function makeCtx(tenantId: string): RequestContext {
  return { tenantId, actorId: randomUUID(), roles: ["workflow_user", "super_admin"], correlationId: randomUUID(), sessionId: "s1" } as RequestContext;
}

type Item = { docType: string; mandatory: boolean; provided: boolean; verified?: boolean };
function mockChecklist(items: Item[], status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ items, complete: false }), { status }) as unknown as Response);
}

/** An instance whose pending task is bound to a citizen application. */
async function applicationTask(tenant: string, refType = "application"): Promise<{ task: Record<string, unknown>; instanceId: string; applicationId: string }> {
  const def = await seedDefinition(tenant, [
    { nodeKey: "inspection", name: "Inspection", nodeType: "task", sortOrder: 1 },
    { nodeKey: "decision", name: "Decision", nodeType: "task", sortOrder: 2 },
  ], [{ fromNode: "inspection", toNode: "decision", sortOrder: 1 }]);
  const instanceId = randomUUID();
  const applicationId = randomUUID();
  await q.deliver(COMMANDS.createInstance, {
    id: instanceId, tenantId: tenant, name: "app", status: "active", version: 1, initialTaskName: "Inspection",
    definitionCode: def.code, refType, refId: applicationId, context: {},
  }, { tenantId: tenant, actorId: randomUUID(), messageId: instanceId });
  const rows = (await sqlAsTenant(tenant, sql`SELECT * FROM workflow.tasks WHERE instance_id = ${instanceId} AND status = 'pending'`)) as unknown as Array<Record<string, unknown>>;
  return { task: rows[0]!, instanceId, applicationId };
}

async function blockedHistory(tenant: string, instanceId: string) {
  const rows = (await sqlAsTenant(tenant, sql`SELECT detail FROM workflow.transition_history WHERE instance_id = ${instanceId} AND action = 'blocked'`)) as unknown as Array<{ detail: unknown }>;
  return rows.map((r) => (typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail) as Record<string, unknown>);
}

describe("doc-gate unit", () => {
  it("only gates tasks with a node, a ref and an application refType", () => {
    expect(isDocGatedTask({ nodeKey: "inspection", refId: "x", refType: "application" })).toBe(true);
    expect(isDocGatedTask({ nodeKey: "inspection", refId: "x", refType: "Citizen_Application" })).toBe(true);
    expect(isDocGatedTask({ nodeKey: "inspection", refId: "x", refType: "leave_app" })).toBe(false);
    expect(isDocGatedTask({ nodeKey: null, refId: "x", refType: "application" })).toBe(false);
    expect(isDocGatedTask({ nodeKey: "inspection", refId: null, refType: "application" })).toBe(false);
  });

  it("asks citizen-service with the internal boundary headers and a normalised lane key", async () => {
    const fetchMock = mockChecklist([{ docType: "id", mandatory: true, provided: true }]);
    const tenant = randomUUID();
    const appId = randomUUID();
    const res = await checkMandatoryDocs(tenant, { nodeKey: "Lane_Inspection", refType: "application", refId: appId });
    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/citizen/documents/verification-lane?");
    expect(String(url)).toContain("laneKey=inspection");
    expect(String(url)).toContain(`applicationId=${appId}`);
    const h = (init as RequestInit).headers as Record<string, string>;
    expect(h["x-internal"]).toBe("1");
    expect(h["x-tenant-id"]).toBe(tenant);
    expect(h["x-service-secret"]).toBe(process.env.INTERNAL_SERVICE_SECRET);
  });

  it("counts only mandatory documents that are not provided; fails closed on bad responses", async () => {
    mockChecklist([
      { docType: "a", mandatory: true, provided: false },
      { docType: "b", mandatory: true, provided: true },
      { docType: "c", mandatory: false, provided: false },
    ]);
    const t = { nodeKey: "inspection", refType: "application", refId: randomUUID() };
    expect(await checkMandatoryDocs(randomUUID(), t)).toEqual({ ok: false, reason: "missing", missingMandatory: 1 });
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }) as unknown as Response);
    expect(await checkMandatoryDocs(randomUUID(), t)).toMatchObject({ ok: false, reason: "unavailable" });
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ nope: 1 }), { status: 200 }) as unknown as Response);
    expect(await checkMandatoryDocs(randomUUID(), t)).toMatchObject({ ok: false, reason: "unavailable" });
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await checkMandatoryDocs(randomUUID(), t)).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

describe("completeTask (POST /complete) mandatory-document gate", () => {
  it("REFUSES approve with 409 MANDATORY_DOCUMENTS_MISSING and audits the refusal", async () => {
    const tenant = newTenant();
    const { task, instanceId } = await applicationTask(tenant);
    mockChecklist([{ docType: "id", mandatory: true, provided: false }, { docType: "photo", mandatory: false, provided: false }]);
    await expect(asTenant(tenant, () => completeTask(makeCtx(tenant), task.id as string, "approve")))
      .rejects.toMatchObject({ status: 409, code: "MANDATORY_DOCUMENTS_MISSING" });
    const hist = await blockedHistory(tenant, instanceId);
    expect(hist).toEqual([{ reason: "mandatory_documents_missing", missingMandatory: 1 }]);
    // nothing was published / completed
    const rows = (await sqlAsTenant(tenant, sql`SELECT status FROM workflow.tasks WHERE id = ${task.id as string}`)) as unknown as Array<{ status: string }>;
    expect(rows[0]!.status).toBe("pending");
  });

  it("ACCEPTS approve when every mandatory document is present", async () => {
    const tenant = newTenant();
    const { task, instanceId } = await applicationTask(tenant);
    mockChecklist([{ docType: "id", mandatory: true, provided: true }, { docType: "photo", mandatory: false, provided: false }]);
    const res = await asTenant(tenant, () => completeTask(makeCtx(tenant), task.id as string, "approve"));
    expect(res).toMatchObject({ status: "accepted", id: task.id });
    expect(await blockedHistory(tenant, instanceId)).toEqual([]);
  });

  it("fails closed with 503 DOCUMENT_CHECK_UNAVAILABLE when the checklist cannot be read, and audits it", async () => {
    const tenant = newTenant();
    const { task, instanceId } = await applicationTask(tenant);
    mockChecklist([], 500);
    await expect(asTenant(tenant, () => completeTask(makeCtx(tenant), task.id as string, "approve")))
      .rejects.toMatchObject({ status: 503, code: "DOCUMENT_CHECK_UNAVAILABLE" });
    expect(await blockedHistory(tenant, instanceId)).toEqual([{ reason: "document_check_unavailable" }]);
  });

  it("never gates reject / return (they do not even consult citizen-service)", async () => {
    const tenant = newTenant();
    const { task } = await applicationTask(tenant);
    const fetchMock = mockChecklist([{ docType: "id", mandatory: true, provided: false }]);
    await expect(asTenant(tenant, () => completeTask(makeCtx(tenant), task.id as string, "reject", "no docs"))).resolves.toMatchObject({ status: "accepted" });
    await expect(asTenant(tenant, () => completeTask(makeCtx(tenant), task.id as string, "return", "send back"))).resolves.toMatchObject({ status: "accepted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not gate a non-application task", async () => {
    const tenant = newTenant();
    const { task } = await applicationTask(tenant, "leave_app");
    const fetchMock = mockChecklist([{ docType: "id", mandatory: true, provided: false }]);
    await expect(asTenant(tenant, () => completeTask(makeCtx(tenant), task.id as string, "approve"))).resolves.toMatchObject({ status: "accepted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("tasks consumer mandatory-document gate (authoritative re-check)", () => {
  async function deliverComplete(tenant: string, task: Record<string, unknown>, decision: "approve" | "reject") {
    await q.deliver(COMMANDS.completeTask, {
      id: task.id, tenantId: tenant, instanceId: task.instance_id, name: task.name, status: "pending",
      roleRef: task.role_ref, nodeKey: task.node_key, refType: task.ref_type, refId: task.ref_id,
      decision, sodOverride: true,
    }, { tenantId: tenant, actorId: randomUUID(), messageId: randomUUID() });
  }
  const taskStatus = async (tenant: string, id: string) =>
    ((await sqlAsTenant(tenant, sql`SELECT status FROM workflow.tasks WHERE id = ${id}`)) as unknown as Array<{ status: string }>)[0]!.status;

  it("does not complete or advance on a bypassing approve command with missing docs; audits it", async () => {
    const tenant = newTenant();
    const { task, instanceId } = await applicationTask(tenant);
    mockChecklist([{ docType: "id", mandatory: true, provided: false }]);
    await deliverComplete(tenant, task, "approve");
    expect(await taskStatus(tenant, task.id as string)).toBe("pending");
    expect(await blockedHistory(tenant, instanceId)).toEqual([{ reason: "mandatory_documents_missing", missingMandatory: 1 }]);
  });

  it("completes the approve when all mandatory documents are present", async () => {
    const tenant = newTenant();
    const { task } = await applicationTask(tenant);
    mockChecklist([{ docType: "id", mandatory: true, provided: true }]);
    await deliverComplete(tenant, task, "approve");
    expect(await taskStatus(tenant, task.id as string)).toBe("completed");
  });

  it("throws (for DLQ retry) rather than approving when the checklist is unavailable", async () => {
    const tenant = newTenant();
    const { task } = await applicationTask(tenant);
    mockChecklist([], 503);
    await expect(deliverComplete(tenant, task, "approve")).rejects.toThrow();
    expect(await taskStatus(tenant, task.id as string)).toBe("pending");
  });

  it("a reject is never blocked by missing documents", async () => {
    const tenant = newTenant();
    const { task } = await applicationTask(tenant);
    const fetchMock = mockChecklist([{ docType: "id", mandatory: true, provided: false }]);
    await deliverComplete(tenant, task, "reject");
    expect(await taskStatus(tenant, task.id as string)).toBe("completed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
