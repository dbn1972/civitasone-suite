/**
 * UX R1 (approvals inbox -> decide): the workflow-level summary API and the inbox reads.
 *  - POST /v1/workflow/ref-summaries is tenant- and participant-scoped (the #2445
 *    participantFilterSql gate): a non-participant never gets a summary;
 *  - it is batched: one SQL statement for the scope, one call per owning service per 50 refs and
 *    one people lookup, never a call per row;
 *  - an unknown refType (or an owning service that fails) degrades to the workflow-level summary;
 *  - GET /v1/workflow/inbox tabs and counts agree with the existing pending inbox;
 *  - GET /v1/workflow/inbox/tasks/:id/context is 404 for a non-participant and flags the maker (SoD).
 */
import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { buildRefSummaries, type SummaryDeps } from "../src/modules/inbox/summaries.js";
import { participantInstancesForRefs } from "../src/modules/inbox/repo.js";
import { resolvePeople } from "../src/shared/people-client.js";
import { seedDefinition, sqlAsTenant, asTenant, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET as string;
const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }
afterEach(async () => { vi.restoreAllMocks(); if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

const auth = (tenant: string, roles: string[], sub = randomUUID()) =>
  ({ authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "s-r1" }, SECRET)}` });

async function withApp<T>(fn: (app: FastifyInstance) => Promise<T>): Promise<T> {
  const app = await buildApp();
  try { return await fn(app); } finally { await app.close(); }
}

type Seeded = { inst: string; refId: string; task: string };

/** One active instance on (refType, refId) raised by `maker`, with one pending task for `role`. */
async function seed(tenant: string, o: { refType: string; maker: string; role: string; name?: string; due?: string | null; definitionId?: string | null }): Promise<Seeded> {
  const inst = randomUUID(), refId = randomUUID(), task = randomUUID();
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.instances (id, tenant_id, name, status, ref_type, ref_id, definition_id, created_by, updated_by)
    VALUES (${inst}, ${tenant}, ${o.name ?? "Approval"}, ${"active"}, ${o.refType}, ${refId}, ${o.definitionId ?? null}, ${o.maker}, ${o.maker})`);
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, ref_type, ref_id, due_at, is_call, created_by, updated_by)
    VALUES (${task}, ${tenant}, ${inst}, ${"Review"}, ${"pending"}, ${o.role}, ${o.refType}, ${refId}, ${o.due ?? null}, false, ${o.maker}, ${o.maker})`);
  return { inst, refId, task };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Stub the owning services: procurement answers for every ref it is sent; hrms knows the makers. */
function stubUpstreams(people: Record<string, { fullName: string; designationName?: string }> = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/procurement/approvals/ref-summaries")) {
      const refs = (JSON.parse(String(init?.body ?? "{}")) as { refs: Array<{ refType: string; refId: string }> }).refs;
      return json({ data: refs.map((r, i) => ({ refType: r.refType, refId: r.refId, label: `PO/2026/${String(i + 1).padStart(4, "0")}`, amountMinor: "12345600" })) });
    }
    if (url.includes("/v1/hrms/leave-requests")) return json([]);
    if (url.includes("/v1/hrms/internal/employee-summaries")) {
      const ids = new URL(url).searchParams.get("actorIds")?.split(",") ?? [];
      return json(ids.filter((id) => people[id]).map((id) => ({ userRef: id, ...people[id] })));
    }
    if (url.includes("/identity/internal/user-summaries")) return json([]);
    return json({}, 404);
  });
}

describe("POST /v1/workflow/ref-summaries: scoping", () => {
  it("returns business context for a participant and nothing for a non-participant or another tenant", async () => {
    const tenant = newTenant();
    const maker = randomUUID();
    const s = await seed(tenant, { refType: "procurement_po", maker, role: "procurement_admin", name: "Purchase Order Approval" });
    stubUpstreams({ [maker]: { fullName: "Anita Verma", designationName: "Section Officer" } });
    await withApp(async (app) => {
      const body = { refs: [{ refType: "procurement_po", refId: s.refId }] };
      const ok = await app.inject({ method: "POST", url: "/v1/workflow/ref-summaries", headers: auth(tenant, ["procurement_admin"]), payload: body });
      expect(ok.statusCode).toBe(200);
      const [row] = (ok.json() as { data: Array<Record<string, unknown>> }).data;
      expect(row).toMatchObject({ kind: "business", reference: "PO/2026/0001", amountMinor: "12345600", maker: { name: "Anita Verma", designation: "Section Officer" } });
      expect(JSON.stringify(row)).not.toContain(maker);

      // A role-holder of an unrelated chain, in the same tenant: not a participant.
      const outsider = await app.inject({ method: "POST", url: "/v1/workflow/ref-summaries", headers: auth(tenant, ["hr_admin"]), payload: body });
      expect(outsider.statusCode).toBe(200);
      expect((outsider.json() as { data: unknown[] }).data).toEqual([]);

      // The right role in ANOTHER tenant sees nothing either.
      const other = await app.inject({ method: "POST", url: "/v1/workflow/ref-summaries", headers: auth(newTenant(), ["procurement_admin"]), payload: body });
      expect((other.json() as { data: unknown[] }).data).toEqual([]);

      // The maker (requester) is a participant of their own instance.
      const own = await app.inject({ method: "POST", url: "/v1/workflow/ref-summaries", headers: auth(tenant, ["workflow_user"], maker), payload: body });
      expect((own.json() as { data: unknown[] }).data).toHaveLength(1);

      // A refType nobody knows degrades gracefully: 200, the known ref still answered, no error.
      const mixed = await app.inject({ method: "POST", url: "/v1/workflow/ref-summaries", headers: auth(tenant, ["procurement_admin"]), payload: { refs: [...body.refs, { refType: "made_up_type", refId: randomUUID() }] } });
      expect(mixed.statusCode).toBe(200);
      expect((mixed.json() as { data: Array<{ refType: string }> }).data.map((d) => d.refType)).toEqual(["procurement_po"]);
    });
  });

  it("rejects an oversized or malformed batch with 400", async () => {
    const tenant = newTenant();
    await withApp(async (app) => {
      const h = auth(tenant, ["workflow_admin"]);
      const tooMany = { refs: Array.from({ length: 201 }, () => ({ refType: "procurement_po", refId: randomUUID() })) };
      expect((await app.inject({ method: "POST", url: "/v1/workflow/ref-summaries", headers: h, payload: tooMany })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/v1/workflow/ref-summaries", headers: h, payload: { refs: [{ refType: "x", refId: "nope" }] } })).statusCode).toBe(400);
    });
  });
});

describe("ref summaries: batching and graceful degradation", () => {
  it("40 procurement refs, 5 leave refs and 5 unknown refs cost one SQL statement and a bounded set of upstream calls", async () => {
    const tenant = newTenant();
    const makers = Array.from({ length: 5 }, () => randomUUID());
    const refs: Array<{ refType: string; refId: string }> = [];
    for (let i = 0; i < 40; i++) refs.push({ refType: "procurement_indent", refId: (await seed(tenant, { refType: "procurement_indent", maker: makers[i % 5]!, role: "procurement_admin" })).refId });
    for (let i = 0; i < 5; i++) refs.push({ refType: "leave_app", refId: (await seed(tenant, { refType: "leave_app", maker: makers[i]!, role: "procurement_admin" })).refId });
    for (let i = 0; i < 5; i++) refs.push({ refType: "asset_disposal", refId: (await seed(tenant, { refType: "asset_disposal", maker: makers[i]!, role: "procurement_admin", name: "Asset Disposal Approval" })).refId });

    const fetchSpy = stubUpstreams(Object.fromEntries(makers.map((m, i) => [m, { fullName: `Officer ${i}`, designationName: "Under Secretary" }])));
    const counts = { sql: 0, people: 0 };
    const deps: SummaryDeps = {
      instancesForRefs: async (...a) => { counts.sql += 1; return participantInstancesForRefs(...a); },
      people: async (...a) => { counts.people += 1; return resolvePeople(...a); },
      fetchImpl: (...a) => fetch(...a),
    };
    const out = await asTenant(tenant, () => buildRefSummaries(tenant, { roles: ["procurement_admin"], actorId: randomUUID() }, refs, deps));

    expect(out).toHaveLength(50);
    expect(counts.sql).toBe(1);
    expect(counts.people).toBe(1);
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes("/procurement/approvals/ref-summaries"))).toHaveLength(1);
    expect(calls.filter((u) => u.includes("/hrms/leave-requests"))).toHaveLength(1);
    expect(calls.filter((u) => u.includes("employee-summaries"))).toHaveLength(1);
    // procurement + leave + people + (no identity fallback: hrms knew everyone)
    expect(calls.length).toBeLessThanOrEqual(4);

    const unknown = out.filter((s) => s.refType === "asset_disposal");
    expect(unknown).toHaveLength(5);
    for (const u of unknown) {
      expect(u.kind).toBe("generic");
      expect(u.instanceName).toBe("Asset Disposal Approval");
      expect(u.reference).toBeNull();
      expect(u.maker?.designation).toBe("Under Secretary");
    }
    expect(out.filter((s) => s.refType === "procurement_indent").every((s) => s.kind === "business" && s.amountMinor === "12345600")).toBe(true);
  });

  it("an owning service that is down still yields the workflow-level summary", async () => {
    const tenant = newTenant();
    const s = await seed(tenant, { refType: "procurement_po", maker: randomUUID(), role: "procurement_admin", name: "Purchase Order Approval" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const out = await asTenant(tenant, () => buildRefSummaries(tenant, { roles: ["procurement_admin"], actorId: randomUUID() }, [{ refType: "procurement_po", refId: s.refId }]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "generic", instanceName: "Purchase Order Approval", maker: null });
  });

  it("the stage reads Level n of m from the definition and the completed steps", async () => {
    const tenant = newTenant();
    const def = await seedDefinition(tenant, [
      { nodeKey: "so", name: "Section Officer", nodeType: "task", sortOrder: 1 },
      { nodeKey: "us", name: "Under Secretary", nodeType: "task", sortOrder: 2 },
      { nodeKey: "ds", name: "Deputy Secretary", nodeType: "task", sortOrder: 3 },
    ], []);
    const maker = randomUUID();
    const s = await seed(tenant, { refType: "estab_file", maker, role: "manager", definitionId: def.id });
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET name = ${"Deputy Secretary Approval"} WHERE id = ${s.task}`);
    await sqlAsTenant(tenant, sql`
      INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, completed_by, is_call, created_by, updated_by)
      VALUES (${randomUUID()}, ${tenant}, ${s.inst}, ${"Section Officer Check"}, ${"completed"}, ${"manager"}, ${randomUUID()}, false, ${maker}, ${maker})`);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
    const [row] = await asTenant(tenant, () => buildRefSummaries(tenant, { roles: ["manager"], actorId: randomUUID() }, [{ refType: "estab_file", refId: s.refId }]));
    expect(row?.stage).toEqual({ level: 2, of: 3, step: "Deputy Secretary Approval" });
  });
});

describe("GET /v1/workflow/inbox: tabs and counts", () => {
  it("waiting matches the pending inbox total, sent lists my raised items, done lists what I decided; overdue first", async () => {
    const tenant = newTenant();
    const me = randomUUID(), other = randomUUID();
    const past = new Date(Date.now() - 2 * 86400000).toISOString();
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    const a = await seed(tenant, { refType: "procurement_po", maker: other, role: "manager", due: future });
    const b = await seed(tenant, { refType: "procurement_po", maker: other, role: "manager", due: past });
    await seed(tenant, { refType: "procurement_po", maker: other, role: "finance_officer" });
    const mine = await seed(tenant, { refType: "leave_app", maker: me, role: "hr_admin" });
    const decided = await seed(tenant, { refType: "leave_app", maker: other, role: "manager" });
    await sqlAsTenant(tenant, sql`UPDATE workflow.tasks SET status = ${"completed"}, completed_by = ${me}, decision = ${"approve"} WHERE id = ${decided.task}`);

    await withApp(async (app) => {
      const h = auth(tenant, ["manager", "workflow_user"], me);
      const waiting = await app.inject({ method: "GET", url: "/v1/workflow/inbox?tab=waiting&limit=50", headers: h });
      expect(waiting.statusCode).toBe(200);
      const w = waiting.json() as { data: Array<{ id: string }>; pagination: { total: number }; counts: Record<string, number> };
      expect(w.data.map((r) => r.id)).toEqual([b.task, a.task]);
      const legacy = await app.inject({ method: "GET", url: "/v1/workflow/tasks?status=pending&limit=50", headers: h });
      expect(w.pagination.total).toBe((legacy.json() as { pagination: { total: number } }).pagination.total);
      expect(w.counts).toEqual({ waiting: 2, overdue: 1, sent: 1, done: 1 });

      const sent = (await app.inject({ method: "GET", url: "/v1/workflow/inbox?tab=sent", headers: h })).json() as { data: Array<{ id: string }> };
      expect(sent.data.map((r) => r.id)).toEqual([mine.task]);
      const done = (await app.inject({ method: "GET", url: "/v1/workflow/inbox?tab=done", headers: h })).json() as { data: Array<{ id: string; decision: string }> };
      expect(done.data.map((r) => r.id)).toEqual([decided.task]);

      const counts = await app.inject({ method: "GET", url: "/v1/workflow/inbox/counts", headers: h });
      expect((counts.json() as { data: unknown }).data).toEqual(w.counts);
    });
  });
});

describe("GET /v1/workflow/inbox/tasks/:id/context", () => {
  it("is 404 for a non-participant; the maker is blocked by SoD; a checker may act; names never ids", async () => {
    const tenant = newTenant();
    const maker = randomUUID();
    const s = await seed(tenant, { refType: "procurement_po", maker, role: "procurement_admin", name: "Purchase Order Approval" });
    await sqlAsTenant(tenant, sql`
      INSERT INTO workflow.transition_history (tenant_id, instance_id, action, actor_id, detail)
      VALUES (${tenant}, ${s.inst}, ${"create"}, ${maker}, ${JSON.stringify({})}::jsonb)`);
    stubUpstreams({ [maker]: { fullName: "Anita Verma", designationName: "Section Officer" } });
    await withApp(async (app) => {
      const url = `/v1/workflow/inbox/tasks/${s.task}/context`;
      expect((await app.inject({ method: "GET", url, headers: auth(tenant, ["hr_admin"]) })).statusCode).toBe(404);

      const checker = await app.inject({ method: "GET", url, headers: auth(tenant, ["procurement_admin"]) });
      expect(checker.statusCode).toBe(200);
      const c = (checker.json() as { data: Record<string, any> }).data;
      expect(c.permissions).toMatchObject({ canAct: true, sodBlock: null, blockedReason: null });
      expect(c.maker).toEqual({ name: "Anita Verma", designation: "Section Officer" });
      expect(c.trail[0]).toMatchObject({ action: "create", actor: { name: "Anita Verma", designation: "Section Officer" } });
      expect(c.summary).toMatchObject({ reference: "PO/2026/0001" });
      expect(JSON.stringify(c.trail)).not.toContain(maker);

      const own = await app.inject({ method: "GET", url, headers: auth(tenant, ["procurement_admin"], maker) });
      expect((own.json() as { data: Record<string, any> }).data.permissions.sodBlock).toBe("maker");
    });
  });
});
