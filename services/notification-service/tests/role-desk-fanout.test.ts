/**
 * notify-roles — a desk / role recipient is expanded to the real users holding the role, and each user
 * then goes through the ordinary send consumer (preferences, consent, idempotency).
 *
 * DB-backed against the Postgres in DATABASE_URL, with tenants unique to this file. The identity-service
 * lookup is the only seam (its HTTP contract is covered by identity-service's own route test); the
 * outbox rows the fan-out writes are replayed into the real send consumer, standing in for the relay.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { emailAdapter } from "../src/adapters/index.js";
import { registerDeliveryConsumers } from "../src/modules/deliveries/consumer.js";
import { setRoleHolderLookupForTests, resetRoleHolderLookup } from "../src/modules/deliveries/role-fanout.js";
import { DESK_ROLES, deskFor } from "../src/modules/deliveries/role-recipients.js";
import type { RoleHolder, RoleHolderQuery } from "../src/modules/deliveries/role-holders-client.js";

const TENANT = randomUUID();     // the tenant whose event raised the notice
const PLATFORM = randomUUID();   // where the platform operators live
const SYSTEM = "00000000-0000-0000-0000-000000000001";
const TEMPLATE = randomUUID();
const EVENT = `notify.roles.${randomUUID()}`;

async function asTenant<T>(tenant: string, fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}
async function seedTemplate(tenant: string): Promise<void> {
  await asTenant(tenant, (sql) => sql`
    INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, created_by, updated_by)
    VALUES (${TEMPLATE}, ${tenant}, 'email', 'Desk', 'Subject', 'Body', ${SYSTEM}, ${SYSTEM})
    ON CONFLICT (id) DO NOTHING`);
}
async function optOut(tenant: string, userId: string): Promise<void> {
  await asTenant(tenant, (sql) => sql`
    INSERT INTO templates.prefs (id, tenant_id, user_id, event_type, in_app, email, push, sms, whatsapp, created_by, updated_by)
    VALUES (${randomUUID()}, ${tenant}, ${userId}, ${EVENT}, false, false, false, null, null, ${SYSTEM}, ${SYSTEM})`);
}
async function cleanup(): Promise<void> {
  for (const t of [TENANT, PLATFORM]) {
    await asTenant(t, async (sql) => {
      await sql`DELETE FROM deliveries.deliveries WHERE tenant_id = ${t}`;
      await sql`DELETE FROM templates.prefs WHERE tenant_id = ${t}`;
      await sql`DELETE FROM templates.templates WHERE tenant_id = ${t}`;
    });
    await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`;
  }
}

type Child = { id: string; tenant_id: string; payload: Record<string, unknown> };
async function children(): Promise<Child[]> {
  return sqlClient`SELECT id, tenant_id, payload FROM _outbox.messages
    WHERE topic = 'notification.send' AND payload->>'eventType' = ${EVENT} ORDER BY created_at, id` as unknown as Promise<Child[]>;
}
async function audits(): Promise<Array<{ payload: Record<string, unknown> }>> {
  return sqlClient`SELECT payload FROM _outbox.messages
    WHERE topic = 'audit.event.record' AND payload->>'action' = 'role_fanout' AND tenant_id = ${TENANT}` as unknown as Promise<Array<{ payload: Record<string, unknown> }>>;
}
async function deliveredTo(tenant: string, userId: string): Promise<string[]> {
  const rows = await asTenant(tenant, (sql) => sql`
    SELECT status FROM deliveries.deliveries WHERE tenant_id = ${tenant} AND recipient_id = ${userId}`) as unknown as Array<{ status: string }>;
  return rows.map((r) => r.status);
}

let queue: MemoryQueue;
let emailSpy: ReturnType<typeof vi.spyOn>;
let lookups: RoleHolderQuery[];

function holders(list: RoleHolder[]): void {
  setRoleHolderLookupForTests(async (q) => { lookups.push(q); return { holders: list, truncated: false }; });
}
async function publishDesk(desk: string, messageId = randomUUID()): Promise<string> {
  await queue.publish("notification.send", {
    messageId, type: "notification.send", tenantId: TENANT, actorId: SYSTEM, correlationId: randomUUID(),
    schemaVersion: "1.0", payload: { templateId: TEMPLATE, recipient: desk, recipientId: desk, eventType: EVENT, variables: { a: "b" } },
  });
  await vi.waitFor(async () => { expect((await audits()).length).toBeGreaterThan(0); }, { timeout: 5000 });
  return messageId;
}
/** Stand-in for the relay: hand every fan-out child to the real send consumer. */
async function relayChildren(): Promise<void> {
  for (const c of await children()) {
    await queue.publish("notification.send", {
      messageId: c.id, type: "notification.send", tenantId: c.tenant_id, actorId: SYSTEM,
      correlationId: randomUUID(), schemaVersion: "1.0", payload: c.payload,
    });
  }
  await new Promise((r) => setTimeout(r, 600));
}

beforeEach(async () => {
  await cleanup();
  await seedTemplate(TENANT);
  await seedTemplate(PLATFORM);
  lookups = [];
  queue = new MemoryQueue();
  registerDeliveryConsumers(queue);
  await queue.start();
  emailSpy = vi.spyOn(emailAdapter, "send");
});
afterEach(async () => { emailSpy.mockRestore(); resetRoleHolderLookup(); await cleanup(); });
afterAll(async () => { await sqlClient.end(); });

describe("desk -> role map", () => {
  it("maps every desk label to its real role and scope", () => {
    expect(DESK_ROLES.security_control_room).toEqual({ scope: "tenant", roles: ["security_admin"] });
    expect(DESK_ROLES.contract_management_desk).toEqual({ scope: "tenant", roles: ["contract_admin"] });
    expect(DESK_ROLES.platform_billing_desk).toEqual({ scope: "platform", roles: ["platform_admin", "super_admin"] });
    expect(DESK_ROLES.all_users).toEqual({ scope: "tenant_all", roles: [] });
  });
  it("an ordinary recipient (or a prototype key) is not a desk", () => {
    expect(deskFor(randomUUID())).toBeNull();
    expect(deskFor("constructor")).toBeNull();
    expect(deskFor(undefined)).toBeNull();
  });
});

describe("desk fan-out through the real send consumer", () => {
  it("a role with 3 users produces 3 deliveries, one per user, and the desk label itself gets none", async () => {
    const u = [randomUUID(), randomUUID(), randomUUID()];
    holders(u.map((userId) => ({ userId, tenantId: TENANT })));
    await publishDesk("security_control_room");
    expect(lookups[0]).toMatchObject({ scope: "tenant", roles: ["security_admin"], tenantId: TENANT });
    await relayChildren();

    for (const id of u) expect(await deliveredTo(TENANT, id)).toEqual(["delivered"]);
    const desk = await asTenant(TENANT, (sql) => sql`SELECT 1 FROM deliveries.deliveries WHERE tenant_id = ${TENANT} AND recipient = 'security_control_room'`);
    expect(desk).toHaveLength(0);
    expect(emailSpy).toHaveBeenCalledTimes(3);
    expect((await audits())[0]?.payload).toMatchObject({ desk: "security_control_room", recipientCount: 3, outcome: "success", truncated: false });
  });

  it("a user who opted out is skipped; the others still get it", async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    holders([a, b, c].map((userId) => ({ userId, tenantId: TENANT })));
    await optOut(TENANT, b);
    await publishDesk("contract_management_desk");
    await relayChildren();

    expect(await deliveredTo(TENANT, a)).toEqual(["delivered"]);
    expect(await deliveredTo(TENANT, b)).toEqual(["skipped"]);
    expect(await deliveredTo(TENANT, c)).toEqual(["delivered"]);
    expect(emailSpy).toHaveBeenCalledTimes(2);
  });

  it("a platform-role notice raised by a tenant event reaches the platform users, under THEIR tenant", async () => {
    const op = randomUUID(), op2 = randomUUID();
    holders([{ userId: op, tenantId: PLATFORM }, { userId: op2, tenantId: PLATFORM }]);
    await publishDesk("platform_billing_desk");
    expect(lookups[0]).toMatchObject({ scope: "platform", roles: ["platform_admin", "super_admin"] });
    const kids = await children();
    expect(kids.map((k) => k.tenant_id)).toEqual([PLATFORM, PLATFORM]);
    await relayChildren();

    expect(await deliveredTo(PLATFORM, op)).toEqual(["delivered"]);
    expect(await deliveredTo(PLATFORM, op2)).toEqual(["delivered"]);
    expect(await deliveredTo(TENANT, op)).toEqual([]);
  });

  it("redelivery of the same desk message, and a user listed twice, never duplicate a send", async () => {
    const u = randomUUID();
    holders([{ userId: u, tenantId: TENANT }, { userId: u, tenantId: TENANT }]);
    const messageId = await publishDesk("security_control_room");
    await queue.publish("notification.send", {
      messageId, type: "notification.send", tenantId: TENANT, actorId: SYSTEM, correlationId: randomUUID(),
      schemaVersion: "1.0", payload: { templateId: TEMPLATE, recipient: "security_control_room", recipientId: "security_control_room", eventType: EVENT },
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(await children()).toHaveLength(1);
    expect((await audits())).toHaveLength(1);
    await relayChildren();
    await relayChildren(); // the relay itself redelivering the child
    expect(await deliveredTo(TENANT, u)).toEqual(["delivered"]);
  });

  it("an empty role is audited as no_recipients, not silently dropped; an identity outage is NOT read as empty", async () => {
    holders([]);
    await publishDesk("security_control_room");
    expect(await children()).toHaveLength(0);
    expect((await audits())[0]?.payload).toMatchObject({ outcome: "no_recipients", recipientCount: 0 });

    const before = (await audits()).length;
    setRoleHolderLookupForTests(async () => { throw new Error("identity down"); });
    const id = randomUUID();
    await queue.publish("notification.send", {
      messageId: id, type: "notification.send", tenantId: TENANT, actorId: SYSTEM, correlationId: randomUUID(),
      schemaVersion: "1.0", payload: { templateId: TEMPLATE, recipient: "all_users", recipientId: "all_users", eventType: EVENT },
    });
    await new Promise((r) => setTimeout(r, 400));
    expect((await audits()).length).toBe(before);   // nothing consumed: the queue can retry it
  });

  it("all_users records a truncation at the hard cap in the audit", async () => {
    setRoleHolderLookupForTests(async () => ({ holders: [{ userId: randomUUID(), tenantId: TENANT }], truncated: true }));
    await publishDesk("all_users");
    expect((await audits())[0]?.payload).toMatchObject({ desk: "all_users", scope: "tenant_all", outcome: "truncated", truncated: true });
  });
});
