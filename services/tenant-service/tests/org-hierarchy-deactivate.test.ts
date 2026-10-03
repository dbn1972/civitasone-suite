/**
 * GAP-ADMIN-ORG-03: deactivating (end-dating) an org unit. Real Postgres under
 * FORCED RLS: the conditional UPDATE refuses a unit with an in-force child, a
 * double deactivate applies once, a deactivated parent accepts no new children,
 * and every applied change writes its audit row with the reason.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { orgUnits } from "../src/modules/org-hierarchy/schema.js";
import { registerOrgHierarchyConsumers } from "../src/modules/org-hierarchy/consumer.js";
import * as repo from "../src/modules/org-hierarchy/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-2222-4000-8000-0000000000d1";
const T_OTHER = "aaaaaaaa-2222-4000-8000-0000000000d2";
const ACTOR = "cccccccc-3333-4000-8000-0000000000d1";
const tok = (tid: string, roles = ["platform_admin"]) => signToken({ sub: ACTOR, tid, roles, sid: "s-deact" }, SECRET);
const uid = () => randomUUID();

async function wipe(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => { await tx.delete(orgUnits).where(eq(orgUnits.tenantId, tenantId)); }));
}

async function pub(q: MemoryQueue, topic: string, tenantId: string, payload: Record<string, unknown>, messageId = uid()): Promise<void> {
  await q.publish(topic, { messageId, type: topic, tenantId, actorId: ACTOR, correlationId: uid(), schemaVersion: "1.0", payload: { tenantId, ...payload } });
  await q.drain();
}
const create = (q: MemoryQueue, tenantId: string, id: string, name: string, parentId?: string) =>
  pub(q, "tenant.org_unit.create", tenantId, { id, name, type: "department", ...(parentId ? { parentId } : {}) });

async function auditFor(tenantId: string, resourceId: string, action: string) {
  const rows = await sqlClient<Array<{ payload: unknown }>>`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenantId} AND topic = 'audit.event.record'`;
  return rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
    .filter((p) => p.resourceId === resourceId && p.action === action);
}

async function http(method: string, url: string, tid: string, payload?: unknown, roles?: string[]) {
  const app = await buildApp();
  const r = await app.inject({ method: method as "POST", url, headers: { authorization: `Bearer ${tok(tid, roles)}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  await app.close();
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

describe("org unit deactivate", () => {
  beforeAll(async () => { await wipe(T); await wipe(T_OTHER); });
  afterAll(async () => { await wipe(T); await wipe(T_OTHER); });

  it("end-dates a leaf unit with an audit row carrying the reason; the row is kept", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const id = uid();
    await create(q, T, id, "Old Section");
    await pub(q, "tenant.org_unit.deactivate", T, { id, reason: "Merged into Accounts" });
    await q.stop();
    const row = await repo.findById(T, id);
    expect(row?.effectiveTo).toBeInstanceOf(Date);
    const audit = await auditFor(T, id, "deactivate_org_unit");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ reason: "Merged into Accounts", resourceType: "org_unit" });
  });

  it("refuses a unit that still has an in-force child; allowed once the child is deactivated", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const parent = uid(); const child = uid();
    await create(q, T, parent, "Parent"); await create(q, T, child, "Child", parent);
    await pub(q, "tenant.org_unit.deactivate", T, { id: parent, reason: "should not apply" });
    expect((await repo.findById(T, parent))?.effectiveTo).toBeNull();
    expect(await auditFor(T, parent, "deactivate_org_unit")).toHaveLength(0);

    await pub(q, "tenant.org_unit.deactivate", T, { id: child, reason: "child first" });
    await pub(q, "tenant.org_unit.deactivate", T, { id: parent, reason: "now empty" });
    await q.stop();
    expect((await repo.findById(T, parent))?.effectiveTo).toBeInstanceOf(Date);
  });

  it("race: two deactivations of the same unit (distinct messages) apply once and audit once", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const id = uid();
    await create(q, T, id, "Twice");
    await Promise.all([
      q.publish("tenant.org_unit.deactivate", { messageId: uid(), type: "tenant.org_unit.deactivate", tenantId: T, actorId: ACTOR, correlationId: uid(), schemaVersion: "1.0", payload: { id, tenantId: T, reason: "first click" } }),
      q.publish("tenant.org_unit.deactivate", { messageId: uid(), type: "tenant.org_unit.deactivate", tenantId: T, actorId: ACTOR, correlationId: uid(), schemaVersion: "1.0", payload: { id, tenantId: T, reason: "second click" } }),
    ]);
    await q.drain(); await q.stop();
    expect(await auditFor(T, id, "deactivate_org_unit")).toHaveLength(1);
    expect((await repo.findById(T, id))?.version).toBe(2);
  });

  it("a child cannot be created under a deactivated parent (consumer defence-in-depth)", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const parent = uid(); const late = uid();
    await create(q, T, parent, "Closed");
    await pub(q, "tenant.org_unit.deactivate", T, { id: parent, reason: "closing" });
    await create(q, T, late, "Late child", parent);
    await q.stop();
    expect(await repo.findById(T, late)).toBeUndefined();
  });

  it("another tenant's unit cannot be deactivated (RLS)", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const id = uid();
    await create(q, T, id, "Mine");
    await pub(q, "tenant.org_unit.deactivate", T_OTHER, { id, reason: "cross tenant attempt" });
    await q.stop();
    expect((await repo.findById(T, id))?.effectiveTo).toBeNull();
  });

  it("HTTP: reason required (400), 404 unknown, 409 HAS_ACTIVE_CHILDREN / ALREADY_INACTIVE, 403 for a non-admin, 202 otherwise", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const parent = uid(); const child = uid();
    await create(q, T, parent, "HTTP parent"); await create(q, T, child, "HTTP child", parent);
    await q.stop();
    expect((await http("POST", `/v1/org/hierarchy/${parent}/deactivate`, T, {})).status).toBe(400);
    expect((await http("POST", `/v1/org/hierarchy/${uid()}/deactivate`, T, { reason: "no such unit" })).status).toBe(404);
    expect((await http("POST", `/v1/org/hierarchy/${parent}/deactivate`, T, { reason: "has a child" }, ["employee"])).status).toBe(403);
    const blocked = await http("POST", `/v1/org/hierarchy/${parent}/deactivate`, T, { reason: "has a child" });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain("HAS_ACTIVE_CHILDREN");
    const ok = await http("POST", `/v1/org/hierarchy/${child}/deactivate`, T, { reason: "no longer needed" });
    expect(ok.status).toBe(202);
  });

  it("HTTP: reparenting under, or creating beneath, a deactivated unit is 409 PARENT_INACTIVE; ALREADY_INACTIVE on repeat", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const dead = uid(); const mover = uid();
    await create(q, T, dead, "Dead"); await create(q, T, mover, "Mover");
    await pub(q, "tenant.org_unit.deactivate", T, { id: dead, reason: "closed down" });
    await q.stop();
    const patch = await http("PATCH", `/v1/org/hierarchy/${mover}`, T, { parentId: dead });
    expect(patch.status).toBe(409);
    expect(JSON.stringify(patch.body)).toContain("PARENT_INACTIVE");
    const post = await http("POST", "/v1/org/hierarchy", T, { name: "Under dead", type: "unit", parentId: dead });
    expect(post.status).toBe(409);
    const again = await http("POST", `/v1/org/hierarchy/${dead}/deactivate`, T, { reason: "twice" });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toContain("ALREADY_INACTIVE");
  });
});

// ── reviewer follow-ups ─────────────────────────────────────────────────────
import { isUnitInactive, istDate } from "../src/modules/org-hierarchy/state.js";
import { positions } from "../src/modules/positions/schema.js";

async function setEffectiveTo(tenantId: string, id: string, iso: string | null): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.update(orgUnits).set({ effectiveTo: iso ? new Date(iso) : null }).where(eq(orgUnits.id, id));
  }));
}

describe("inactive means effectiveTo <= today (IST), in both places", () => {
  it("istDate/isUnitInactive: same IST day is inactive, tomorrow is not, across the UTC/IST midnight gap", () => {
    // 2026-10-03T19:00Z is already 2026-10-04 00:30 IST.
    const now = new Date("2026-10-03T19:00:00Z");
    expect(istDate(now)).toBe("2026-10-04");
    expect(isUnitInactive({ effectiveTo: null }, now)).toBe(false);
    expect(isUnitInactive({ effectiveTo: new Date("2026-10-03T20:00:00Z") }, now)).toBe(true); // 05 Oct 01:30 IST? no: 04 Oct 01:30 IST = same IST day
    expect(isUnitInactive({ effectiveTo: new Date("2026-10-04T19:00:00Z") }, now)).toBe(false); // 05 Oct IST
    expect(isUnitInactive({ effectiveTo: new Date("2026-10-01T00:00:00Z") }, now)).toBe(true);
  });

  it("a unit end-dated to a future day is still in force: it can be renamed and can still be deactivated", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const id = uid();
    await create(q, T, id, "Future end");
    await setEffectiveTo(T, id, new Date(Date.now() + 3 * 86_400_000).toISOString());
    const rename = await http("PATCH", `/v1/org/hierarchy/${id}`, T, { name: "Future end renamed" });
    expect(rename.status).toBe(202);
    // The HTTP routes publish on the app's own queue singleton, so the effect is driven through this suite's consumers.
    expect((await http("POST", `/v1/org/hierarchy/${id}/deactivate`, T, { reason: "bring forward" })).status).toBe(202);
    await pub(q, "tenant.org_unit.deactivate", T, { id, reason: "bring forward" });
    await q.stop();
    expect(isUnitInactive((await repo.findById(T, id))!)).toBe(true);
  });

  it("a unit with only a future-dated child end date still counts that child as active", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const parent = uid(); const child = uid();
    await create(q, T, parent, "P"); await create(q, T, child, "C", parent);
    await setEffectiveTo(T, child, new Date(Date.now() + 5 * 86_400_000).toISOString());
    expect(await repo.countActiveChildren(T, parent)).toBe(1);
    await setEffectiveTo(T, child, new Date(Date.now() - 86_400_000).toISOString());
    expect(await repo.countActiveChildren(T, parent)).toBe(0);
    await q.stop();
  });
});

describe("PATCH on an inactive unit is refused", () => {
  it("409 UNIT_INACTIVE for rename, set head and reparent; the consumer also ignores a queued update", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const dead = uid(); const other = uid();
    await create(q, T, dead, "Dead unit"); await create(q, T, other, "Live unit");
    await pub(q, "tenant.org_unit.deactivate", T, { id: dead, reason: "closed down" });
    for (const body of [{ name: "New name" }, { headUserId: uid() }, { parentId: other }]) {
      const r = await http("PATCH", `/v1/org/hierarchy/${dead}`, T, body);
      expect(r.status).toBe(409);
      expect(JSON.stringify(r.body)).toContain("UNIT_INACTIVE");
    }
    // A command that got past the route (queued before the deactivation) must not change the row either.
    await pub(q, "tenant.org_unit.update", T, { id: dead, name: "Sneaky rename" });
    await q.stop();
    expect((await repo.findById(T, dead))?.name).toBe("Dead unit");
  });
});

describe("deactivate and active positions", () => {
  async function addPosition(unitId: string, status = "active"): Promise<void> {
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.insert(positions).values({ tenantId: T, orgUnitId: unitId, code: `P-${uid().slice(0, 8)}`, title: "Clerk", status, createdBy: ACTOR });
    }));
  }

  it("409 HAS_ACTIVE_POSITIONS with the count; nothing is queued; an acknowledged override goes through and is audited", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const id = uid();
    await create(q, T, id, "Has staff");
    await addPosition(id); await addPosition(id, "frozen"); await addPosition(id, "abolished");
    const refused = await http("POST", `/v1/org/hierarchy/${id}/deactivate`, T, { reason: "restructure" });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("HAS_ACTIVE_POSITIONS");
    expect(JSON.stringify(refused.body)).toContain("2 open positions");
    await q.drain();
    expect((await repo.findById(T, id))?.effectiveTo).toBeNull();

    const ok = await http("POST", `/v1/org/hierarchy/${id}/deactivate`, T, { reason: "restructure", acknowledgePositions: true });
    expect(ok.status).toBe(202);
    await pub(q, "tenant.org_unit.deactivate", T, { id, reason: "restructure", positionsAcknowledged: true });
    await q.stop();
    expect(isUnitInactive((await repo.findById(T, id))!)).toBe(true);
    expect((await auditFor(T, id, "deactivate_org_unit"))[0]).toMatchObject({ positionsAcknowledged: true });
  });

  it("abolished positions alone do not block", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    const id = uid();
    await create(q, T, id, "Only closed");
    await addPosition(id, "abolished");
    expect((await http("POST", `/v1/org/hierarchy/${id}/deactivate`, T, { reason: "no staff left" })).status).toBe(202);
    await q.stop();
  });
});

describe("a child create racing a deactivate of its parent", () => {
  it("never ends with an in-force child under an inactive parent (20 rounds, distinct messages, concurrent)", async () => {
    const q = new MemoryQueue(); registerOrgHierarchyConsumers(q); await q.start();
    for (let i = 0; i < 20; i++) {
      const parent = uid(); const child = uid();
      await create(q, T, parent, `Race parent ${i}`);
      const env = (topic: string, payload: Record<string, unknown>) => ({ messageId: uid(), type: topic, tenantId: T, actorId: ACTOR, correlationId: uid(), schemaVersion: "1.0", payload: { tenantId: T, ...payload } });
      await Promise.all([
        q.publish("tenant.org_unit.create", env("tenant.org_unit.create", { id: child, name: `Race child ${i}`, type: "unit", parentId: parent })),
        q.publish("tenant.org_unit.deactivate", env("tenant.org_unit.deactivate", { id: parent, reason: "race round" })),
      ]);
      await q.drain();
      const p = await repo.findById(T, parent);
      const c = await repo.findById(T, child);
      const parentInactive = isUnitInactive(p!);
      const childActive = c !== undefined && !isUnitInactive(c);
      // Either the child won (parent stays active, deactivate refused) or the deactivate won (child never created).
      expect(parentInactive && childActive).toBe(false);
      expect(parentInactive || c !== undefined).toBe(true);
    }
    await q.stop();
  });
});

// Closed last so every describe above can use the shared connection.
afterAll(async () => { await wipe(T); await sqlClient.end(); });
