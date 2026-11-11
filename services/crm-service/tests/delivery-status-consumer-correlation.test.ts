import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Queue } from "@civitasone/queue";

const H = vi.hoisted(() => ({ executed: [] as unknown[] }));
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: async (q: unknown) => { H.executed.push(q); return []; } }) },
}));
vi.mock("../src/shared/outbox.js", () => ({ markProcessed: vi.fn(async () => true) }));

import { registerDeliveryStatusConsumers } from "../src/modules/communications/delivery-status-consumer.js";

/** Collect every bound parameter value of a drizzle sql`` object. */
function params(q: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (c: unknown): void => {
    if (typeof c === "string") out.push(c);
    else if (c && typeof c === "object") {
      const o = c as { queryChunks?: unknown[]; value?: unknown; constructor?: { name?: string } };
      if (Array.isArray(o.queryChunks)) o.queryChunks.forEach(walk);
      else if (o.constructor?.name === "Param") out.push(o.value);
    }
  };
  walk(q);
  return out;
}

function stub() {
  const handlers = new Map<string, (m: unknown) => Promise<void>>();
  const queue = { subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); }, publish: async () => {} } as unknown as Queue;
  registerDeliveryStatusConsumers(queue);
  return handlers;
}

const DELIVERY = "6b0f3c1e-8a52-4e7d-9c14-2d5a7e9b1f30";
const COMM = "c3a9d4e2-1b67-4f08-8e35-9a7c2b4d6e10";
const msg = (payload: Record<string, unknown>, correlationId: string) =>
  ({ messageId: "m-1", correlationId, tenantId: "8dcb509d-1a2e-41dc-8dbd-61a3a11b9d93", actorId: "a", payload });

/**
 * REGRESSION (UAT 9 Nov): document-service bulk-scan stamps correlationId "bulk-scan-dispatch" on its
 * events. This consumer compared crm.communications.id (uuid) to msg.correlationId unconditionally, so
 * the non-uuid string made Postgres throw "invalid input syntax for type uuid" and the message went
 * to the DLQ every ~80 s.
 */
describe("CRM delivery-status consumer: non-uuid correlationId", () => {
  beforeEach(() => { H.executed.length = 0; });

  for (const topic of ["notification.delivered", "notification.failed"]) {
    it(`${topic}: never binds a non-uuid correlationId against a uuid column`, async () => {
      const h = stub();
      await h.get(topic)!(msg({ deliveryId: DELIVERY }, "bulk-scan-dispatch"));
      expect(H.executed).toHaveLength(1);
      expect(params(H.executed[0])).not.toContain("bulk-scan-dispatch");
      expect(params(H.executed[0])).toContain(DELIVERY);
    });

    it(`${topic}: still matches by a uuid correlationId (the CRM communication id)`, async () => {
      const h = stub();
      await h.get(topic)!(msg({ deliveryId: DELIVERY }, COMM));
      expect(params(H.executed[0])).toEqual(expect.arrayContaining([DELIVERY, COMM]));
    });

    it(`${topic}: an event with neither a uuid delivery id nor a uuid correlationId is ignored without a query`, async () => {
      const h = stub();
      await h.get(topic)!(msg({ deliveryId: "not-a-uuid" }, "bulk-scan-dispatch"));
      expect(H.executed).toHaveLength(0);
    });
  }
});
