/**
 * V4-C-04 (market slice) -- allotment_number / request_number came from
 * crypto.randomInt(1, 999999) into fleet-global UNIQUE columns, so two
 * independent records could draw the same suffix and the second insert failed
 * inside the consumer transaction after the caller already received 202.
 * randomInt is pinned to a constant here: any dependence on it collides
 * deterministically; numbers must come from a DB sequence instead.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

vi.mock("node:crypto", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:crypto")>();
  return { ...orig, randomInt: () => 4242 };
});

import { db, sqlClient } from "../src/shared/db.js";
import { marketAllotments } from "../src/modules/allotments/schema.js";
import { marketLifecycleRequests } from "../src/modules/lifecycle/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerAllotmentConsumers } from "../src/modules/allotments/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const TENANTS = [randomUUID(), randomUUID()];
const ACTOR = randomUUID();

function msg(type: string, tenantId: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId, ...payload },
  };
}

async function clean() {
  for (const t of TENANTS) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
        await tx.delete(marketLifecycleRequests).where(eq(marketLifecycleRequests.tenantId, t));
        await tx.delete(marketAllotments).where(eq(marketAllotments.tenantId, t));
      }),
    );
  }
}

beforeAll(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("V4-C-04 market reference numbers never collide", () => {
  it("allotment and lifecycle numbers are unique across tenants and request types", async () => {
    const q = tenantScoped(new MemoryQueue());
    registerAllotmentConsumers(q);
    registerLifecycleConsumers(q);
    await q.start();
    const allotmentIds: string[] = [];
    const requestIds: string[] = [];
    for (const t of TENANTS) {
      const aid = randomUUID();
      allotmentIds.push(aid);
      await q.publish(COMMANDS.applyAllotment, msg(COMMANDS.applyAllotment, t, {
        id: aid, propertyId: randomUUID(), allotteeName: "Allottee", allotmentType: "direct",
      }));
      await q.drain();
      for (const [cmd, extra] of [
        [COMMANDS.requestTransfer, { transfereeName: "T" }],
        [COMMANDS.requestCancellation, {}],
        [COMMANDS.initiateEviction, { reason: "r" }],
      ] as const) {
        const rid = randomUUID();
        requestIds.push(rid);
        await q.publish(cmd, msg(cmd, t, { id: rid, allotmentId: aid, ...extra }));
        await q.drain();
      }
    }
    expect((q as unknown as MemoryQueue).dlq, "unique violations were swallowed into the DLQ").toHaveLength(0);
    await q.stop();

    const nums: string[] = [];
    for (const t of TENANTS) {
      const a = await runWithTenant(t, () => db.transaction((tx) => tx.select().from(marketAllotments).where(inArray(marketAllotments.id, allotmentIds))));
      const r = await runWithTenant(t, () => db.transaction((tx) => tx.select().from(marketLifecycleRequests).where(inArray(marketLifecycleRequests.id, requestIds))));
      nums.push(...a.map((x) => x.allotmentNumber), ...r.map((x) => x.requestNumber));
    }
    expect(nums).toHaveLength(2 + 6);
    expect(new Set(nums).size).toBe(nums.length);
  });
});
