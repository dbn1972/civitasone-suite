/**
 * GAP-ADMIN-ONBOARDING-05/-07, GAP-ADMIN-OPERATORS-06: the platform onboarding
 * queue (masked contact, audited reveal, race-safe stage moves, tenant isolation)
 * and the audited export endpoint. Real Postgres, real RLS, non-superuser role.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPlatformOpsConsumers } from "../src/modules/platform-ops/consumer.js";
import { canTransition, maskEmail, maskName, maskedContact } from "../src/modules/platform-ops/domain.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T_A = "aaaaaaaa-0045-4000-8000-000000000001";
const T_B = "bbbbbbbb-0045-4000-8000-000000000002";
const OP = "aaaaaaaa-0045-4000-8000-0000000000a1";
const OP2 = "aaaaaaaa-0045-4000-8000-0000000000a2";

const hdr = (tid: string, sub: string, roles: string[] = ["platform_admin"]) => ({
  authorization: `Bearer ${signToken({ sub, tid, roles, sid: "sess-platform-ops" }, SECRET, 3600)}`,
});

let app: FastifyInstance;

async function auditRows(tenantId: string, action: string, resourceId?: string) {
  const rows = await sqlClient<Array<{ payload: unknown }>>`
    SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = 'audit.event.record'`;
  return rows
    .map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
    .filter((p) => p.action === action && (resourceId === undefined || p.resourceId === resourceId));
}

async function create(tid: string, orgName: string, contactName = "Jane Doe", contactEmail = "jane.doe@dept.gov.in"): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/admin/onboarding", headers: hdr(tid, OP), payload: { orgName, contactName, contactEmail } });
  expect(r.statusCode).toBe(202);
  await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
  return r.json().data?.id ?? r.json().id;
}

beforeAll(async () => {
  registerPlatformOpsConsumers(queue);
  await queue.start();
  app = await buildApp();
});
afterAll(async () => { await app.close(); await queue.stop(); await sqlClient.end(); });

describe("masking helpers", () => {
  it("masks e-mail, name and the combined contact", () => {
    expect(maskEmail("jane.doe@dept.gov.in")).toBe("j***@dept.gov.in");
    expect(maskEmail("nobody")).toBe("***");
    expect(maskEmail("")).toBe("");
    expect(maskName("Jane Doe")).toBe("J*** D***");
    expect(maskedContact("Jane Doe", "jane.doe@dept.gov.in")).toBe("J*** D*** · j***@dept.gov.in");
  });
  it("stage machine: terminals are final, completed is only reachable from go-live pending", () => {
    expect(canTransition("new request", "in progress")).toBe(true);
    expect(canTransition("new request", "completed")).toBe(false);
    expect(canTransition("go-live pending", "completed")).toBe(true);
    expect(canTransition("completed", "in progress")).toBe(false);
    expect(canTransition("rejected", "new request")).toBe(false);
  });
});

describe("GET/POST /v1/admin/onboarding", () => {
  it("403 for a tenant_admin on every endpoint", async () => {
    const h = hdr(T_A, OP, ["tenant_admin"]);
    expect((await app.inject({ method: "GET", url: "/v1/admin/onboarding", headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/admin/platform-exports/audit", headers: h, payload: { resource: "operators", rowCount: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/admin/onboarding/${randomUUID()}/reveal`, headers: h, payload: { reason: "support ticket" } })).statusCode).toBe(403);
  });

  it("creates through the queue, lists the row with a MASKED contact, writes an audit row without the contact", async () => {
    const org = `Dept of Roads ${randomUUID()}`;
    const id = await create(T_A, org);
    const list = await app.inject({ method: "GET", url: "/v1/admin/onboarding", headers: hdr(T_A, OP) });
    expect(list.statusCode).toBe(200);
    const row = (list.json().data as Array<Record<string, unknown>>).find((r) => r.id === id)!;
    expect(row).toMatchObject({ org, contact: "J*** D*** · j***@dept.gov.in", stage: "new request", assigned: "" });
    expect(JSON.stringify(list.json())).not.toContain("jane.doe@dept.gov.in");
    const audits = await auditRows(T_A, "create", id);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain("jane.doe");
  });

  it("400 for a bad e-mail", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/admin/onboarding", headers: hdr(T_A, OP), payload: { orgName: "X Org", contactName: "A", contactEmail: "nope" } });
    expect(r.statusCode).toBe(400);
  });

  it("tenant B never sees tenant A's request (RLS)", async () => {
    const id = await create(T_A, `Isolation org ${randomUUID()}`);
    const list = await app.inject({ method: "GET", url: "/v1/admin/onboarding", headers: hdr(T_B, OP) });
    expect((list.json().data as Array<{ id: string }>).find((r) => r.id === id)).toBeUndefined();
    expect((await app.inject({ method: "GET", url: `/v1/admin/onboarding/${id}`, headers: hdr(T_B, OP) })).statusCode).toBe(404);
  });
});

describe("PATCH /v1/admin/onboarding/:id/stage", () => {
  it("moves along the machine, records the assignee and audits from/to", async () => {
    const id = await create(T_A, `Move org ${randomUUID()}`);
    const r = await app.inject({ method: "PATCH", url: `/v1/admin/onboarding/${id}/stage`, headers: hdr(T_A, OP),
      payload: { from: "new request", to: "in progress", assignedTo: OP, assignedToName: "Asha Rao" } });
    expect(r.statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    const got = await app.inject({ method: "GET", url: `/v1/admin/onboarding/${id}`, headers: hdr(T_A, OP) });
    expect(got.json().data).toMatchObject({ stage: "in progress", assigned: "Asha Rao" });
    const audits = await auditRows(T_A, "stage_change", id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ from: "new request", to: "in progress" });
  });

  it("409 for an illegal edge and for a stale `from`", async () => {
    const id = await create(T_A, `Edge org ${randomUUID()}`);
    const bad = await app.inject({ method: "PATCH", url: `/v1/admin/onboarding/${id}/stage`, headers: hdr(T_A, OP), payload: { from: "new request", to: "completed" } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error?.code ?? bad.json().code).toBe("ILLEGAL_TRANSITION");
    const stale = await app.inject({ method: "PATCH", url: `/v1/admin/onboarding/${id}/stage`, headers: hdr(T_A, OP), payload: { from: "in progress", to: "go-live pending" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error?.code ?? stale.json().code).toBe("STAGE_CHANGED");
  });

  it("race: two operators moving the same request from the same stage - exactly one wins, one audit row", async () => {
    const id = await create(T_A, `Race org ${randomUUID()}`);
    // Bypass the route pre-check (both would pass it) and publish both commands, as two near-simultaneous requests would.
    const publish = (actor: string, to: string) => queue.publish(COMMANDS.onboardingMove, {
      messageId: randomUUID(), type: COMMANDS.onboardingMove, tenantId: T_A, actorId: actor, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: T_A, requestId: id, from: "new request", to, assignedToName: actor === OP ? "Op One" : "Op Two" },
    });
    await Promise.all([publish(OP, "in progress"), publish(OP2, "rejected")]);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    const got = (await app.inject({ method: "GET", url: `/v1/admin/onboarding/${id}`, headers: hdr(T_A, OP) })).json().data;
    expect(["in progress", "rejected"]).toContain(got.stage);
    expect(await auditRows(T_A, "stage_change", id)).toHaveLength(1);
  });

  it("a replayed message (same messageId) is applied once", async () => {
    const id = await create(T_A, `Replay org ${randomUUID()}`);
    const messageId = randomUUID();
    const env = { messageId, type: COMMANDS.onboardingMove, tenantId: T_A, actorId: OP, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), tenantId: T_A, requestId: id, from: "new request", to: "in progress" } };
    await queue.publish(COMMANDS.onboardingMove, env);
    await queue.publish(COMMANDS.onboardingMove, env);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    expect(await auditRows(T_A, "stage_change", id)).toHaveLength(1);
  });
});

describe("POST /v1/admin/onboarding/:id/reveal", () => {
  it("requires a reason, returns the clear contact and publishes one audited reveal", async () => {
    const id = await create(T_A, `Reveal org ${randomUUID()}`);
    expect((await app.inject({ method: "POST", url: `/v1/admin/onboarding/${id}/reveal`, headers: hdr(T_A, OP), payload: {} })).statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: `/v1/admin/onboarding/${id}/reveal`, headers: hdr(T_A, OP), payload: { reason: "Call back about the go-live date" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ contactName: "Jane Doe", contactEmail: "jane.doe@dept.gov.in" });
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    const audits = await auditRows(T_A, "reveal", id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ resourceType: "platform_onboarding", reason: "Call back about the go-live date", fields: ["contactName", "contactEmail"] });
    expect(JSON.stringify(audits[0])).not.toContain("jane.doe@dept.gov.in");
  });

  it("fails closed: when the audit command cannot be published the clear value is NOT returned", async () => {
    const id = await create(T_A, `Closed org ${randomUUID()}`);
    const spy = vi.spyOn(queue, "publish").mockRejectedValueOnce(new Error("queue down"));
    const r = await app.inject({ method: "POST", url: `/v1/admin/onboarding/${id}/reveal`, headers: hdr(T_A, OP), payload: { reason: "support ticket 4411" } });
    spy.mockRestore();
    expect(r.statusCode).toBeGreaterThanOrEqual(500);
    expect(r.body).not.toContain("jane.doe@dept.gov.in");
  });

  it("404 for another tenant's request", async () => {
    const id = await create(T_A, `Cross org ${randomUUID()}`);
    const r = await app.inject({ method: "POST", url: `/v1/admin/onboarding/${id}/reveal`, headers: hdr(T_B, OP), payload: { reason: "should not work" } });
    expect(r.statusCode).toBe(404);
  });
});

describe("POST /v1/admin/platform-exports/audit", () => {
  it("202 and one audited export with the row count and only a filter flag", async () => {
    const t = `aaaaaaaa-0045-4000-8000-${randomUUID().slice(-12)}`;
    const r = await app.inject({ method: "POST", url: "/v1/admin/platform-exports/audit", headers: hdr(t, OP), payload: { resource: "operators", rowCount: 12, filtered: true, filter: "secret text" } });
    expect(r.statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    const audits = await auditRows(t, "export");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ resourceType: "platform_operators", rowCount: 12, filtered: true });
    expect(JSON.stringify(audits[0])).not.toContain("secret text");
  });

  it("400 for an unknown resource or a negative count", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/admin/platform-exports/audit", headers: hdr(T_A, OP), payload: { resource: "tenants", rowCount: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/admin/platform-exports/audit", headers: hdr(T_A, OP), payload: { resource: "operators", rowCount: -1 } })).statusCode).toBe(400);
  });
});

describe("PATCH stage body validation (reviewer follow-up)", () => {
  const patch = (id: string, payload: unknown) => app.inject({ method: "PATCH", url: `/v1/admin/onboarding/${id}/stage`, headers: hdr(T_A, OP), payload: payload as object });

  it("provisionedTenantId is only accepted on the move to completed; assignedTo only on the move to in progress", async () => {
    const id = await create(T_A, `Validation org ${randomUUID()}`);
    expect((await patch(id, { from: "new request", to: "in progress", provisionedTenantId: randomUUID() })).statusCode).toBe(400);
    expect((await patch(id, { from: "new request", to: "rejected", assignedTo: OP, note: "not eligible" })).statusCode).toBe(400);
    expect((await patch(id, { from: "new request", to: "in progress", assignedTo: OP })).statusCode).toBe(202);
  });

  it("both ids must be uuids", async () => {
    const id = await create(T_A, `Uuid org ${randomUUID()}`);
    expect((await patch(id, { from: "new request", to: "in progress", assignedTo: "not-a-uuid" })).statusCode).toBe(400);
    expect((await patch(id, { from: "go-live pending", to: "completed", provisionedTenantId: "nope" })).statusCode).toBe(400);
  });

  it("rejecting or cancelling needs a reason; completing records the provisioned tenant", async () => {
    const id = await create(T_A, `Reason org ${randomUUID()}`);
    expect((await patch(id, { from: "new request", to: "rejected" })).statusCode).toBe(400);
    expect((await patch(id, { from: "new request", to: "cancelled", note: "ab" })).statusCode).toBe(400);
    expect((await patch(id, { from: "new request", to: "in progress" })).statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    expect((await patch(id, { from: "in progress", to: "go-live pending" })).statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    const tenant = randomUUID();
    expect((await patch(id, { from: "go-live pending", to: "completed", provisionedTenantId: tenant })).statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    const got = (await app.inject({ method: "GET", url: `/v1/admin/onboarding/${id}`, headers: hdr(T_A, OP) })).json().data;
    expect(got).toMatchObject({ stage: "completed", provisionedTenantId: tenant });
  });
});
