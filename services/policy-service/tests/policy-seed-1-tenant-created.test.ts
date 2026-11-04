/**
 * POLICY-SEED-1 (UAT bundle 17): a new tenant gets the standard roles and approve grants from tenant.tenant.created,
 * so its non-super_admin approvers can complete workflow tasks (hrms.leave / payroll.run / procurement.* approve).
 * Real Postgres as the policy app role (NOBYPASSRLS, FORCE RLS on roles.*), real consumer on a MemoryQueue.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { db, sqlClient, readScoped } from "../src/shared/db.js";
import { roles, permissions } from "../src/modules/roles/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerTenantProvisionConsumers, newTenantIdOf } from "../src/modules/tenant-provision/consumer.js";
import { standardGrantList, STANDARD_ROLE_GRANTS } from "../src/modules/roles/standard-grants.js";
import { standardId } from "../src/modules/roles/standard-provision.js";
import { backfillStandardGrants, parseArgs, makeTenantIdLister } from "../scripts/backfill-standard-grants.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const PLATFORM = randomUUID(); // a tenant that is NOT the new one (a forged / mis-addressed envelope)
const ACTOR = randomUUID();
const msgIds: string[] = [];
let q: MemoryQueue;

const EXPECTED = standardGrantList().map((g) => `${g.role}:${g.resource}.${g.action}`).sort();

async function grantsOf(tenantId: string): Promise<string[]> {
  const rows = await readScoped(tenantId, (tx) => tx.select({ name: roles.name, resource: permissions.resource, action: permissions.action, effect: permissions.effect })
    .from(permissions).innerJoin(roles, eq(roles.id, permissions.roleId)).where(eq(permissions.tenantId, tenantId)));
  return rows.map((r) => `${r.name}:${r.resource}.${r.action}${r.effect === "allow" ? "" : `(${r.effect})`}`).sort();
}
const rolesOf = async (tenantId: string) => (await readScoped(tenantId, (tx) => tx.select({ name: roles.name }).from(roles).where(eq(roles.tenantId, tenantId)))).map((r) => r.name).sort();

// tenant-service sends the event in the NEW tenant's envelope (tenant/consumer.ts emit: envelope tenantId = payload tenantId).
async function created(tenantId: string, messageId = randomUUID(), payload: Record<string, unknown> = {}, envelopeTenant = tenantId): Promise<void> {
  msgIds.push(messageId);
  await q.publish(CONSUMED_EVENTS.tenantCreated, {
    messageId, type: CONSUMED_EVENTS.tenantCreated, tenantId: envelopeTenant, actorId: ACTOR, correlationId: `ps1-${messageId.slice(0, 8)}`, schemaVersion: "1.1",
    payload: { tenantId, id: tenantId, plan: "govt", edition: "govt", name: "PS1 Office", domain: `ps1-${tenantId.slice(0, 8)}.example.in`, status: "draft", region: "ap-south-1", residency: "IN", ...payload },
  });
  await q.drain();
}

beforeAll(async () => {
  q = new MemoryQueue({ maxAttempts: 1 });
  registerTenantProvisionConsumers(q);
  await q.start();
});
afterAll(async () => {
  await q.stop();
  for (const m of msgIds) await db.delete(processed).where(eq(processed.messageId, m)).catch(() => undefined);
  await sqlClient.end();
});

describe("POLICY-SEED-1: tenant.tenant.created -> standard approve grants", () => {
  it("runs as a non-superuser, NOBYPASSRLS app role (so RLS is really enforced below)", async () => {
    const [me] = (await db.execute(sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    expect(me).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("a new tenant event creates exactly the standard roles and grants, all allow, in the NEW tenant", async () => {
    const t = randomUUID();
    await created(t);
    expect(q.dlq.length).toBe(0);
    expect(await rolesOf(t)).toEqual(Object.keys(STANDARD_ROLE_GRANTS).sort());
    expect(await grantsOf(t)).toEqual(EXPECTED);
    // POLICY-SEED-2: the plan / PO-amendment approvals are part of the set
    expect(EXPECTED).toEqual(expect.arrayContaining(["procurement_admin:procurement.plan.approve", "procurement_admin:procurement.po_amendment.approve"]));
    expect(await rolesOf(PLATFORM)).toEqual([]);
  });

  it("RLS: another tenant context sees none of the new tenant's rows", async () => {
    const t = randomUUID();
    await created(t);
    const other = randomUUID();
    const leak = await readScoped(other, (tx) => tx.select().from(roles).where(eq(roles.tenantId, t)));
    expect(leak).toHaveLength(0);
  });

  it("re-delivery (same message) and a second event for the tenant (new message) create nothing new", async () => {
    const t = randomUUID();
    const m = randomUUID();
    await created(t, m);
    const before = { roles: await rolesOf(t), grants: await grantsOf(t) };
    await created(t, m);
    await created(t);
    expect(await rolesOf(t)).toEqual(before.roles);
    expect(await grantsOf(t)).toEqual(before.grants);
    expect(q.dlq.length).toBe(0);
  });

  it("skips an existing role and keeps an existing grant as it is (a tenant deny stays a deny)", async () => {
    const t = randomUUID();
    const roleId = randomUUID();
    await readScoped(t, async (tx) => {
      await tx.insert(roles).values({ id: roleId, tenantId: t, name: "manager", description: "tenant-made", status: "active", createdBy: ACTOR, updatedBy: ACTOR, version: 1 });
      await tx.insert(permissions).values({ id: randomUUID(), tenantId: t, roleId, resource: "hrms.leave", action: "approve", effect: "deny", createdBy: ACTOR, updatedBy: ACTOR, version: 1 });
    });
    await created(t);
    const g = await grantsOf(t);
    expect(g).toContain("manager:hrms.leave.approve(deny)");
    expect(g).not.toContain("manager:hrms.leave.approve");
    expect(g).toHaveLength(EXPECTED.length);
    const [m] = await readScoped(t, (tx) => tx.select().from(roles).where(and(eq(roles.tenantId, t), eq(roles.name, "manager"))));
    expect(m).toMatchObject({ id: roleId, description: "tenant-made" });
  });

  it("an envelope tenant that is not the new tenant is dead-lettered and writes nothing (forged / mis-addressed event)", async () => {
    const t = randomUUID();
    const before = q.dlq.length;
    await created(t, randomUUID(), {}, PLATFORM);
    expect(q.dlq.length).toBe(before + 1);
    expect(await rolesOf(t)).toEqual([]);
    expect(await rolesOf(PLATFORM)).toEqual([]);
  });

  it("a contract violation is dead-lettered at once and writes nothing", async () => {
    const before = q.dlq.length;
    msgIds.push(randomUUID());
    await q.publish(CONSUMED_EVENTS.tenantCreated, { messageId: msgIds.at(-1)!, type: CONSUMED_EVENTS.tenantCreated, tenantId: PLATFORM, actorId: ACTOR, correlationId: "ps1-bad", schemaVersion: "1.1", payload: { tenantId: "not-a-uuid" } });
    await q.drain();
    expect(q.dlq.length).toBe(before + 1);
    expect(() => newTenantIdOf({ tenantId: randomUUID(), id: randomUUID() })).toThrow(/different tenants/);
  });

  it("deterministic ids: the same tenant always gets the same standard role id", () => {
    const t = randomUUID();
    expect(standardId(t, "standard-role:manager")).toBe(standardId(t, "standard-role:manager"));
    expect(standardId(t, "standard-role:manager")).not.toBe(standardId(randomUUID(), "standard-role:manager"));
  });
});

describe("POLICY-SEED-1 backfill-standard-grants (existing tenants)", () => {
  it("--dry-run reports the missing roles / grants and writes nothing; --apply creates them; a re-run creates none", async () => {
    const t = randomUUID();
    // like UAT tenant A before today's manual fix: one approver role with only its leave grant
    const roleId = randomUUID();
    await readScoped(t, async (tx) => {
      await tx.insert(roles).values({ id: roleId, tenantId: t, name: "hr_admin", description: null, status: "active", createdBy: ACTOR, updatedBy: ACTOR, version: 1 });
      await tx.insert(permissions).values({ id: randomUUID(), tenantId: t, roleId, resource: "hrms.leave", action: "approve", effect: "allow", createdBy: ACTOR, updatedBy: ACTOR, version: 1 });
    });
    const dry = await backfillStandardGrants({ dryRun: true, tenants: [t] });
    expect(dry.grantsToCreate).toBe(EXPECTED.length - 1);
    expect(dry.tenants[0]!.rolesExisting).toEqual(["hr_admin"]);
    expect(await grantsOf(t)).toEqual(["hr_admin:hrms.leave.approve"]);
    const run = await backfillStandardGrants({ dryRun: false, tenants: [t] });
    expect(run.grantsToCreate).toBe(EXPECTED.length - 1);
    expect(await grantsOf(t)).toEqual(EXPECTED);
    const again = await backfillStandardGrants({ dryRun: false, tenants: [t] });
    expect(again.rolesToCreate + again.grantsToCreate).toBe(0);
  });
  it("lists tenants from tenant-service when no --tenant is given", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }) });
    expect(await makeTenantIdLister({ fetchFn, baseUrl: "http://t.test" })()).toEqual(["a", "b"]);
    const r = await backfillStandardGrants({ dryRun: true, listTenantIds: async () => ["not-a-uuid"] });
    expect(r.skipped).toEqual(["not-a-uuid"]);
  });
  it("defaults to a dry run", () => {
    expect(parseArgs([])).toEqual({ dryRun: true, tenants: [] });
    expect(parseArgs(["--apply"]).dryRun).toBe(false);
    expect(() => parseArgs(["--apply", "--dry-run"])).toThrow();
  });
});
