/**
 * V4-G-07 — the durable retry sweeper must republish the ORIGINAL send content
 * (variables, eventType, category, campaignId, subject, body). Without it,
 * placeholders were sent literally on retry and the marketing-consent gate
 * (keyed on category/campaignId/eventType) was skipped.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";

vi.mock("../src/modules/deliveries/channel.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  sendWithFallback: vi.fn(async () => ({ error: "smtp temporary failure", channel: "email" })),
}));

import { registerDeliveryConsumers } from "../src/modules/deliveries/consumer.js";
import { sweepDueRetries } from "../src/modules/deliveries/sweeper.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

async function sqlAsTenant<T>(fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

afterAll(async () => {
  await sqlAsTenant((sql) => sql`DELETE FROM deliveries.deliveries WHERE tenant_id = ${TENANT}`);
  await sqlClient.end();
});

describe("V4-G-07 retry sweeper republishes the original send content", () => {
  it("round-trips variables/eventType/category/campaignId/subject/body through a failed send", async () => {
    const recipient = `citizen-${randomUUID()}@example.org`;
    const q = new MemoryQueue();
    registerDeliveryConsumers(q);
    await q.start();
    await q.publish(COMMANDS.sendNotification, {
      messageId: randomUUID(), type: COMMANDS.sendNotification, tenantId: TENANT, actorId: ACTOR,
      correlationId: "corr-v4g07", schemaVersion: "1.0",
      payload: {
        recipient, channel: "email", eventType: "citizen.application.submitted",
        category: "transactional", subject: "Application {{app_no}}",
        body: "Your application {{app_no}} was received.",
        variables: { app_no: "APP-42" },
      },
    });
    await q.drain();
    await q.stop();

    const rows = await sqlAsTenant((sql) => sql`
      SELECT id, status FROM deliveries.deliveries WHERE tenant_id = ${TENANT} AND recipient = ${recipient}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("queued");
    await sqlAsTenant((sql) => sql`
      UPDATE deliveries.deliveries SET next_retry_at = now() - interval '1 minute' WHERE id = ${rows[0]!.id}`);

    const publish = vi.fn(async () => undefined);
    await sweepDueRetries({ publish } as never, new Date());
    const call = (publish.mock.calls as unknown as Array<[string, { payload: Record<string, unknown> }]>)
      .find((c) => (c[1].payload.deliveryId as string) === rows[0]!.id);
    expect(call).toBeDefined();
    expect(call![1].payload).toMatchObject({
      variables: { app_no: "APP-42" },
      eventType: "citizen.application.submitted",
      category: "transactional",
      subject: "Application {{app_no}}",
      body: "Your application {{app_no}} was received.",
    });
  });
});
