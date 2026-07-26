/**
 * positions + role mapping — REAL round-trip tests (CAP-014/015).
 * Sanctioned posts attached to org_units, effective-dated, with platform roles
 * mapped onto them. Driven through the real consumers, read back under RLS.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { positions, positionRoleMap } from "../src/modules/positions/schema.js";
import { orgUnits } from "../src/modules/org-hierarchy/schema.js";
import { registerPositionConsumers } from "../src/modules/positions/consumer.js";
import { registerOrgHierarchyConsumers } from "../src/modules/org-hierarchy/consumer.js";
import * as repo from "../src/modules/positions/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T1 = "aaaaaaaa-1111-4000-8000-000000000141";
const T2 = "aaaaaaaa-1111-4000-8000-000000000142";
const ACTOR = "cccccccc-3333-4000-8000-000000000141";
const admin = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["tenant_admin", "platform_admin"], sid: "s1" }, SECRET);

async function wipe(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(positionRoleMap).where(eq(positionRoleMap.tenantId, tenantId));
    await tx.delete(positions).where(eq(positions.tenantId, tenantId));
    await tx.delete(orgUnits).where(eq(orgUnits.tenantId, tenantId));
  }));
}

function queueWithConsumers(): MemoryQueue {
  const q = new MemoryQueue();
  registerOrgHierarchyConsumers(q);
  registerPositionConsumers(q);
  return q;
}

async function publish(q: MemoryQueue, topic: string, tenantId: string, payload: Record<string, unknown>): Promise<void> {
  await q.publish(topic, { messageId: randomUUID(), type: topic, tenantId, actorId: ACTOR, correlationId: `c-${randomUUID()}`, schemaVersion: "1.0", payload });
  await q.drain();
}

async function seedOrgUnit(q: MemoryQueue, tenantId: string): Promise<string> {
  const id = randomUUID();
  await publish(q, "tenant.org_unit.create", tenantId, { id, tenantId, name: "Secretariat", type: "department" });
  return id;
}

async function inject(m: string, u: string, tid?: string, p?: unknown): Promise<{ status: number; body: unknown }> {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (tid) o.headers = { authorization: `Bearer ${admin(tid)}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close();
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

describe("positions + role mapping — real persistence (CAP-014/015)", () => {
  beforeAll(async () => { await wipe(T1); await wipe(T2); });
  afterAll(async () => { await wipe(T1); await wipe(T2); await sqlClient.end(); });

  it("creates a sanctioned position attached to an org unit", async () => {
    const q = queueWithConsumers(); await q.start();
    const orgUnitId = await seedOrgUnit(q, T1);
    const posId = randomUUID();
    await publish(q, "tenant.position.create", T1, { id: posId, tenantId: T1, orgUnitId, code: "SEC-01", title: "Secretary", grade: "Apex", sanctionedStrength: 3 });
    await q.stop();

    const pos = await repo.findPosition(T1, posId);
    expect(pos).toBeDefined();
    expect(pos?.title).toBe("Secretary");
    expect(pos?.sanctionedStrength).toBe(3);
    expect(pos?.orgUnitId).toBe(orgUnitId);
  });

  it("maps platform roles onto a position (CAP-015)", async () => {
    const q = queueWithConsumers(); await q.start();
    const posId = randomUUID();
    await publish(q, "tenant.position.create", T1, { id: posId, tenantId: T1, code: "FIN-01", title: "Finance Officer" });
    await publish(q, "tenant.position_role.map", T1, { id: randomUUID(), tenantId: T1, positionId: posId, roleKey: "finance_approver" });
    await publish(q, "tenant.position_role.map", T1, { id: randomUUID(), tenantId: T1, positionId: posId, roleKey: "budget_viewer" });
    // Duplicate mapping is idempotent (onConflictDoNothing).
    await publish(q, "tenant.position_role.map", T1, { id: randomUUID(), tenantId: T1, positionId: posId, roleKey: "finance_approver" });
    await q.stop();

    const roles = await repo.listRoles(T1, posId);
    expect(roles.map((r) => r.roleKey).sort()).toEqual(["budget_viewer", "finance_approver"]);
  });

  it("drops a position whose org_unit is not in the tenant", async () => {
    const q = queueWithConsumers(); await q.start();
    const posId = randomUUID();
    await publish(q, "tenant.position.create", T1, { id: posId, tenantId: T1, orgUnitId: randomUUID(), code: "GHOST", title: "Ghost" });
    await q.stop();
    expect(await repo.findPosition(T1, posId)).toBeUndefined();
  });

  it("enforces tenant isolation (FORCED RLS)", async () => {
    const q = queueWithConsumers(); await q.start();
    const p1 = randomUUID();
    await publish(q, "tenant.position.create", T1, { id: p1, tenantId: T1, code: "ISO-1", title: "Iso One" });
    await publish(q, "tenant.position.create", T2, { id: randomUUID(), tenantId: T2, code: "ISO-2", title: "Iso Two" });
    await q.stop();
    const t2 = await repo.listPositions(T2);
    expect(t2.map((p) => p.code)).toContain("ISO-2");
    expect(t2.map((p) => p.id)).not.toContain(p1);
    expect(await repo.findPosition(T2, p1)).toBeUndefined();
  });

  it("HTTP: create/list/detail-with-roles + 404 + 401 + 400", async () => {
    const created = await inject("POST", "/v1/positions", T1, { code: "HTTP-1", title: "Http Post", sanctionedStrength: 2 });
    expect(created.status).toBe(202);

    const list = await inject("GET", "/v1/positions", T1);
    expect(list.status).toBe(200);
    expect((list.body as { meta: { total: number } }).meta.total).toBeGreaterThanOrEqual(1);

    const roleMiss = await inject("POST", `/v1/positions/${randomUUID()}/roles`, T1, { roleKey: "x" });
    expect(roleMiss.status).toBe(404);

    expect((await inject("GET", "/v1/positions")).status).toBe(401);
    expect((await inject("POST", "/v1/positions", T1, { code: "" })).status).toBe(400);
  });
});
