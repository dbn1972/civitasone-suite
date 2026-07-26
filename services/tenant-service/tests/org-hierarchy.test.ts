/**
 * org-hierarchy — REAL round-trip integration tests (CAP-012).
 *
 * Drives the actual consumers against a MemoryQueue + real Postgres, then reads
 * back through the RLS-scoped repo. Proves: create→persist→read, parent/child
 * level integrity, subtree via recursive CTE, cycle rejection, and tenant
 * isolation under FORCED RLS. Also exercises the HTTP routes for auth/validation
 * and the synchronous cycle 409.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { orgUnits } from "../src/modules/org-hierarchy/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerOrgHierarchyConsumers } from "../src/modules/org-hierarchy/consumer.js";
import * as repo from "../src/modules/org-hierarchy/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "aaaaaaaa-1111-4000-8000-0000000000c1";
const T2 = "aaaaaaaa-1111-4000-8000-0000000000c2";
const ACTOR = "cccccccc-3333-4000-8000-0000000000c1";
const admin = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["platform_admin", "super_admin"], sid: "s1" }, SECRET);

function uuid(suffix: string): string { return `dddddddd-4444-4000-8000-000000${suffix}`; }

async function wipe(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(orgUnits).where(eq(orgUnits.tenantId, tenantId));
  }));
}

/**
 * Publish a create command and deterministically await the consumer via drain().
 * messageId is random (decoupled from the deterministic unit `id`) so the suite
 * is idempotent across reruns — a fixed messageId would be short-circuited by
 * _inbox.processed on the second run. Returns the messageId for inbox assertions.
 */
async function publishCreate(q: MemoryQueue, tenantId: string, id: string, name: string, type: string, parentId?: string): Promise<string> {
  const messageId = randomUUID();
  await q.publish("tenant.org_unit.create", {
    messageId, type: "tenant.org_unit.create", tenantId, actorId: ACTOR,
    correlationId: `c-${id}`, schemaVersion: "1.0",
    payload: { id, tenantId, name, type, ...(parentId ? { parentId } : {}) },
  });
  await q.drain(); // deterministically await consumer fan-out (no fixed sleep / poll)
  return messageId;
}

async function publishUpdate(q: MemoryQueue, tenantId: string, id: string, patch: Record<string, unknown>): Promise<void> {
  await q.publish("tenant.org_unit.update", {
    messageId: randomUUID(), type: "tenant.org_unit.update", tenantId, actorId: ACTOR,
    correlationId: `u-${id}`, schemaVersion: "1.0", payload: { id, tenantId, ...patch },
  });
  await q.drain();
}

async function inject(m: string, u: string, tid?: string, p?: unknown): Promise<{ status: number; body: unknown }> {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (tid) o.headers = { authorization: `Bearer ${admin(tid)}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close();
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

describe("org-hierarchy — real persistence + integrity (RLS)", () => {
  beforeAll(async () => { await wipe(T1); await wipe(T2); });
  afterAll(async () => { await wipe(T1); await wipe(T2); await sqlClient.end(); });

  it("create persists and is readable through the RLS-scoped repo", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const rootId = uuid("0000a1");
    const messageId = await publishCreate(q, T1, rootId, "Directorate", "department");
    await q.stop();

    const row = await repo.findById(T1, rootId);
    expect(row).toBeDefined();
    expect(row?.name).toBe("Directorate");
    expect(row?.level).toBe(1);
    // _inbox.processed recorded (idempotency).
    const seen = await db.select().from(processed).where(eq(processed.messageId, messageId));
    expect(seen).toHaveLength(1);
  });

  it("child unit is placed one level below its parent (hierarchy integrity)", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const rootId = uuid("0000b1"); const childId = uuid("0000b2"); const grandId = uuid("0000b3");
    await publishCreate(q, T1, rootId, "HQ", "department");
    await publishCreate(q, T1, childId, "Finance Wing", "division", rootId);
    await publishCreate(q, T1, grandId, "Accounts", "section", childId);
    await q.stop();

    const child = await repo.findById(T1, childId);
    const grand = await repo.findById(T1, grandId);
    expect(child?.level).toBe(2);
    expect(grand?.level).toBe(3);

    const kids = await repo.findChildren(T1, rootId);
    expect(kids.map((k) => k.id)).toContain(childId);

    const subtree = await repo.getSubtree(T1, rootId);
    expect(subtree.map((s) => s.id).sort()).toEqual([rootId, childId, grandId].sort());
  });

  it("rejects a reparent that would create a cycle", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const a = uuid("0000c1"); const b = uuid("0000c2");
    await publishCreate(q, T1, a, "A", "department");
    await publishCreate(q, T1, b, "B", "division", a); // b under a
    await q.stop();

    // Reparent A under B → cycle (B is a descendant of A).
    expect(await repo.wouldCreateCycle(T1, a, b)).toBe(true);
    // Reparent B under A again → no new cycle (already the case).
    expect(await repo.wouldCreateCycle(T1, b, a)).toBe(false);
    // Self-parent → cycle.
    expect(await repo.wouldCreateCycle(T1, a, a)).toBe(true);
  });

  it("enforces tenant isolation — T2 cannot see T1 org units (FORCED RLS)", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const t1Unit = uuid("0000d1"); const t2Unit = uuid("0000d2");
    await publishCreate(q, T1, t1Unit, "T1 Dept", "department");
    await publishCreate(q, T2, t2Unit, "T2 Dept", "department");
    await q.stop();

    const t2List = await repo.listOrgUnits(T2);
    const ids = t2List.map((u) => u.id);
    expect(ids).toContain(t2Unit);
    expect(ids).not.toContain(t1Unit);
    // Cross-tenant direct fetch is invisible.
    expect(await repo.findById(T2, t1Unit)).toBeUndefined();
  });

  it("HTTP: GET returns persisted units; POST accepts; PATCH cycle → 409", async () => {
    // Seed a small tree via consumer so the HTTP reads have data.
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const root = uuid("0000e1"); const child = uuid("0000e2");
    await publishCreate(q, T1, root, "Root", "department");
    await publishCreate(q, T1, child, "Child", "division", root);
    await q.stop();

    const list = await inject("GET", "/v1/org/hierarchy", T1);
    expect(list.status).toBe(200);
    expect((list.body as { meta: { total: number } }).meta.total).toBeGreaterThanOrEqual(2);

    const created = await inject("POST", "/v1/org/hierarchy", T1, { name: "New Dept", type: "department" });
    expect(created.status).toBe(202);

    // Reparent root under child → 409 cycle.
    const cyc = await inject("PATCH", `/v1/org/hierarchy/${root}`, T1, { parentId: child });
    expect(cyc.status).toBe(409);

    // Non-existent parent → 404.
    const orphan = await inject("POST", "/v1/org/hierarchy", T1, { name: "X", type: "unit", parentId: uuid("00ffff") });
    expect(orphan.status).toBe(404);
  });

  it("update consumer reparents a unit and recomputes its level", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const a = uuid("00aa01"); const b = uuid("00aa02");
    await publishCreate(q, T1, a, "Alpha", "department");   // root, level 1
    await publishCreate(q, T1, b, "Beta", "department");    // root, level 1
    await publishUpdate(q, T1, b, { parentId: a, name: "Beta Renamed" }); // move B under A
    await q.stop();

    const moved = await repo.findById(T1, b);
    expect(moved?.parentId).toBe(a);
    expect(moved?.level).toBe(2);
    expect(moved?.name).toBe("Beta Renamed");

    // Detach back to root via parentId:null → level resets to 1.
    const q2 = new MemoryQueue(); registerOrgHierarchyConsumers(q2); await q2.start();
    await publishUpdate(q2, T1, b, { parentId: null });
    await q2.stop();
    const detached = await repo.findById(T1, b);
    expect(detached?.parentId).toBeNull();
    expect(detached?.level).toBe(1);
  });

  it("update consumer defensively rejects a cyclic reparent", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const a = uuid("00bb01"); const b = uuid("00bb02");
    await publishCreate(q, T1, a, "P", "department");
    await publishCreate(q, T1, b, "C", "division", a); // b under a
    await publishUpdate(q, T1, a, { parentId: b });     // would create cycle — must be dropped
    await q.stop();
    const stillRoot = await repo.findById(T1, a);
    expect(stillRoot?.parentId).toBeNull();
    expect(stillRoot?.level).toBe(1);
  });

  it("HTTP: GET :id (with children), subtree, and a valid PATCH reparent", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const root = uuid("00cc01"); const child = uuid("00cc02"); const loose = uuid("00cc03");
    await publishCreate(q, T1, root, "CcRoot", "department");
    await publishCreate(q, T1, child, "CcChild", "division", root);
    await publishCreate(q, T1, loose, "CcLoose", "department");
    await q.stop();

    const detail = await inject("GET", `/v1/org/hierarchy/${root}`, T1);
    expect(detail.status).toBe(200);
    expect((detail.body as { data: { children: unknown[] } }).data.children.length).toBeGreaterThanOrEqual(1);

    const subtree = await inject("GET", `/v1/org/hierarchy/${root}/subtree`, T1);
    expect(subtree.status).toBe(200);
    expect((subtree.body as { meta: { total: number } }).meta.total).toBeGreaterThanOrEqual(2);

    // Valid reparent of a root-level unit under root → 202.
    const patched = await inject("PATCH", `/v1/org/hierarchy/${loose}`, T1, { parentId: root });
    expect(patched.status).toBe(202);

    // Detail of a non-existent unit → 404.
    expect((await inject("GET", `/v1/org/hierarchy/${uuid("00ffff")}`, T1)).status).toBe(404);
  });

  it("HTTP: 401 without auth, 400 on bad payload", async () => {
    expect((await inject("GET", "/v1/org/hierarchy")).status).toBe(401);
    expect((await inject("POST", "/v1/org/hierarchy", T1, { name: "", type: "bogus" })).status).toBe(400);
  });
});
