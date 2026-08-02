/**
 * Alert-rule and channel consumers (alerts/consumer.ts, channels/consumer.ts).
 *
 * Both had ZERO line coverage. They are the simplest CQRS write handlers in the
 * service, which makes them the right place to pin the pattern every other
 * consumer follows: markProcessed first, business write and outbox rows in ONE
 * transaction, cache invalidated after the transaction commits.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { notificationAlertRules } from "../src/modules/alerts/schema.js";
import { notificationChannels } from "../src/modules/channels/schema.js";
import { registerAlertConsumers } from "../src/modules/alerts/consumer.js";
import { registerChannelConsumers } from "../src/modules/channels/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "d00d0001-1111-4000-8000-000000000001";
const ACTOR = "d00daaaa-1111-4000-8000-0000000000aa";

const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(notificationAlertRules).where(eq(notificationAlertRules.tenantId, TENANT));
    await tx.delete(notificationChannels).where(eq(notificationChannels.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

/** register = which module's consumers to attach to the throwaway queue. */
async function deliver(
  register: (q: MemoryQueue) => void,
  topic: string,
  messageId: string,
  payload: Record<string, unknown>,
): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  register(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: "corr-ac-1", schemaVersion: "1.0", payload,
  });
  await q.drain();
  return q;
}

async function outboxTopics(): Promise<string[]> {
  // _outbox.messages is FORCE RLS — needs a tenant context to read.
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
  return rows.map((r) => r.topic).sort();
}

async function ruleById(id: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(notificationAlertRules).where(eq(notificationAlertRules.id, id))));
  return rows[0];
}

async function channelById(id: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(notificationChannels).where(eq(notificationChannels.id, id))));
  return rows[0];
}

beforeAll(cleanup);
beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("alerts consumer — create rule", () => {
  const RULE = "d00d5001-1111-4000-8000-000000000501";

  const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: RULE, tenantId: TENANT, name: "Payment failure spike",
    triggerEvent: "finance.payment.failed",
    conditions: { threshold: 5, windowMinutes: 10 },
    channel: "email", recipients: ["ops-team"], ...over,
  });

  it("persists the rule enabled by default with the actor as creator", async () => {
    const q = await deliver(registerAlertConsumers, COMMANDS.createAlertRule,
      "d00df001-1111-4000-8000-000000000101", body());

    expect(q.dlq).toHaveLength(0);
    const row = await ruleById(RULE);
    expect(row?.name).toBe("Payment failure spike");
    expect(row?.triggerEvent).toBe("finance.payment.failed");
    expect(row?.enabled).toBe(true);          // consumer hardcodes enabled: true
    expect(row?.createdBy).toBe(ACTOR);
    expect(row?.updatedBy).toBe(ACTOR);
    expect(row?.version).toBe(1);
  });

  it("stores the jsonb conditions and recipients verbatim", async () => {
    await deliver(registerAlertConsumers, COMMANDS.createAlertRule,
      "d00df001-1111-4000-8000-000000000102", body());

    const row = await ruleById(RULE);
    expect(row?.conditions).toEqual({ threshold: 5, windowMinutes: 10 });
    expect(row?.recipients).toEqual(["ops-team"]);
  });

  it("accepts empty conditions and an empty recipient list", async () => {
    const q = await deliver(registerAlertConsumers, COMMANDS.createAlertRule,
      "d00df001-1111-4000-8000-000000000103", body({ conditions: {}, recipients: [] }));

    expect(q.dlq).toHaveLength(0);
    const row = await ruleById(RULE);
    expect(row?.conditions).toEqual({});
    expect(row?.recipients).toEqual([]);
  });

  it("emits the created event and an audit event", async () => {
    await deliver(registerAlertConsumers, COMMANDS.createAlertRule,
      "d00df001-1111-4000-8000-000000000104", body());

    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.alertRuleCreated].sort());
  });

  it("is idempotent — the same messageId twice writes one row and one event pair", async () => {
    const MSG = "d00df001-1111-4000-8000-000000000105";
    await deliver(registerAlertConsumers, COMMANDS.createAlertRule, MSG, body());
    // A second insert of the same primary key would fail loudly; markProcessed
    // must short-circuit before the write.
    const q2 = await deliver(registerAlertConsumers, COMMANDS.createAlertRule, MSG, body());
    expect(q2.dlq).toHaveLength(0);
    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.alertRuleCreated].sort());
  });
});

describe("alerts consumer — enable / disable toggle", () => {
  const RULE = "d00d5002-1111-4000-8000-000000000502";

  async function seedRule(enabled: boolean): Promise<void> {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(notificationAlertRules).values({
        id: RULE, tenantId: TENANT, name: "Nightly digest failure",
        triggerEvent: "notification.digest.failed", conditions: {},
        channel: "email", recipients: [], enabled,
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
    }));
  }

  it("disable flips enabled to false and bumps the version", async () => {
    await seedRule(true);
    const q = await deliver(registerAlertConsumers, COMMANDS.disableAlertRule,
      "d00df002-1111-4000-8000-000000000201", { id: RULE, enabled: false });

    expect(q.dlq).toHaveLength(0);
    const row = await ruleById(RULE);
    expect(row?.enabled).toBe(false);
    expect(row?.version).toBe(2);
  });

  it("enable flips enabled back to true", async () => {
    await seedRule(false);
    const q = await deliver(registerAlertConsumers, COMMANDS.enableAlertRule,
      "d00df002-1111-4000-8000-000000000202", { id: RULE, enabled: true });

    expect(q.dlq).toHaveLength(0);
    expect((await ruleById(RULE))?.enabled).toBe(true);
  });

  it("the toggle records an audit event but no domain event", async () => {
    await seedRule(true);
    await deliver(registerAlertConsumers, COMMANDS.disableAlertRule,
      "d00df002-1111-4000-8000-000000000203", { id: RULE, enabled: false });

    expect(await outboxTopics()).toEqual(["audit.event.record"]);
  });

  it("toggling a rule that does not exist is a silent no-op, not a failure", async () => {
    const q = await deliver(registerAlertConsumers, COMMANDS.disableAlertRule,
      "d00df002-1111-4000-8000-000000000204",
      { id: "d00d5999-1111-4000-8000-000000000599", enabled: false });

    // setRuleEnabled returns early when the row is absent, but the audit event is
    // still enqueued — the operator's intent is recorded either way.
    expect(q.dlq).toHaveLength(0);
    expect(await outboxTopics()).toEqual(["audit.event.record"]);
  });

  it("the toggle is idempotent on redelivery", async () => {
    await seedRule(true);
    const MSG = "d00df002-1111-4000-8000-000000000205";
    await deliver(registerAlertConsumers, COMMANDS.disableAlertRule, MSG, { id: RULE, enabled: false });
    await deliver(registerAlertConsumers, COMMANDS.disableAlertRule, MSG, { id: RULE, enabled: false });

    // One audit row, and the version moved exactly once.
    expect(await outboxTopics()).toEqual(["audit.event.record"]);
    expect((await ruleById(RULE))?.version).toBe(2);
  });
});

describe("channels consumer — create channel", () => {
  const CH = "d00d5003-1111-4000-8000-000000000503";

  const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: CH, tenantId: TENANT, type: "email", name: "Primary SMTP",
    isDefault: true, enabled: true, ...over,
  });

  it("persists the channel with the flags supplied by the command", async () => {
    const q = await deliver(registerChannelConsumers, COMMANDS.createChannel,
      "d00df003-1111-4000-8000-000000000301", body());

    expect(q.dlq).toHaveLength(0);
    const row = await channelById(CH);
    expect(row?.type).toBe("email");
    expect(row?.name).toBe("Primary SMTP");
    expect(row?.isDefault).toBe(true);
    expect(row?.enabled).toBe(true);
    expect(row?.createdBy).toBe(ACTOR);
  });

  it("a non-default, disabled channel round-trips its false flags", async () => {
    const q = await deliver(registerChannelConsumers, COMMANDS.createChannel,
      "d00df003-1111-4000-8000-000000000302", body({ isDefault: false, enabled: false, type: "sms" }));

    expect(q.dlq).toHaveLength(0);
    const row = await channelById(CH);
    expect(row?.isDefault).toBe(false);
    expect(row?.enabled).toBe(false);
    expect(row?.type).toBe("sms");
  });

  it("emits the channelCreated event carrying the type, plus an audit event", async () => {
    await deliver(registerChannelConsumers, COMMANDS.createChannel,
      "d00df003-1111-4000-8000-000000000303", body());

    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.channelCreated].sort());
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, TENANT),
        eq(outboxMessages.topic, EVENTS.channelCreated),
      ))));
    expect(rows[0]?.payload).toMatchObject({ channelId: CH, type: "email" });
  });

  it("is idempotent on redelivery", async () => {
    const MSG = "d00df003-1111-4000-8000-000000000304";
    await deliver(registerChannelConsumers, COMMANDS.createChannel, MSG, body());
    const q2 = await deliver(registerChannelConsumers, COMMANDS.createChannel, MSG, body());

    expect(q2.dlq).toHaveLength(0);
    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.channelCreated].sort());
  });

  it("the channel is invisible to another tenant under FORCE RLS", async () => {
    await deliver(registerChannelConsumers, COMMANDS.createChannel,
      "d00df003-1111-4000-8000-000000000305", body());

    const other = "d00d0002-2222-4000-8000-000000000002";
    const rows = await runWithTenant(other, () => db.transaction((tx) =>
      tx.select().from(notificationChannels).where(and(
        eq(notificationChannels.id, CH),
        eq(notificationChannels.tenantId, TENANT),
      ))));
    expect(rows).toHaveLength(0);
  });
});
