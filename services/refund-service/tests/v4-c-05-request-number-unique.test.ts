/**
 * V4-C-05 -- refund requestNumber was built from Date.now() % 999999: it repeats
 * every ~16.7 minutes and two requests created in the same millisecond (or
 * across tenants) collide on the global UNIQUE request_number, losing the
 * second refund request after the caller already received 202. Date.now is
 * pinned to a constant here: any dependence on the clock collides; numbers
 * must come from a DB sequence. Real Postgres, real RLS.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { refundRequests } from "../src/modules/requests/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerRequestConsumers } from "../src/modules/requests/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const TENANTS = [randomUUID(), randomUUID()];
const ACTOR = randomUUID();

function msg(tenantId: string, id: string) {
  return {
    messageId: randomUUID(), type: COMMANDS.createRequest, tenantId, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id, tenantId, applicantName: "Applicant", applicantPhone: "9000000000",
      originalServiceType: "trade_licence", originalTransactionRef: `TXN-${id.slice(0, 8)}`,
      originalAmountMinor: "100000", refundAmountMinor: "50000", refundReason: "duplicate payment",
    },
  };
}

async function clean() {
  for (const t of TENANTS) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
        await tx.delete(refundRequests).where(eq(refundRequests.tenantId, t));
      }),
    );
  }
}

beforeAll(clean);
afterAll(async () => { vi.restoreAllMocks(); await clean(); await sqlClient.end(); });

describe("V4-C-05 refund request numbers never collide", () => {
  it("requests created at the same instant, across tenants, get distinct numbers", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const q = tenantScoped(new MemoryQueue());
    registerRequestConsumers(q);
    await q.start();
    const ids: string[] = [];
    for (const t of TENANTS) {
      for (let i = 0; i < 2; i++) {
        const id = randomUUID();
        ids.push(id);
        await q.publish(COMMANDS.createRequest, msg(t, id));
        await q.drain();
      }
    }
    expect((q as unknown as MemoryQueue).dlq, "unique violations were swallowed into the DLQ").toHaveLength(0);
    await q.stop();

    const nums: string[] = [];
    for (const t of TENANTS) {
      const rows = await runWithTenant(t, () =>
        db.transaction((tx) => tx.select().from(refundRequests).where(inArray(refundRequests.id, ids))),
      );
      nums.push(...rows.map((r) => r.requestNumber));
    }
    expect(nums).toHaveLength(4);
    expect(new Set(nums).size).toBe(4);
  });
});
