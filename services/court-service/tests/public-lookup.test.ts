/**
 * public-lookup consumer tests — establishment publish emits + audit + idempotency.
 * db/outbox/repo/schema/topics are mocked; the real consumer wiring is exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true }) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async (_tx: unknown, id: string) => {
    if (processedIds.has(id)) return false;
    processedIds.add(id);
    return true;
  }),
  enqueue: vi.fn(async () => {}),
}));

vi.mock("../src/modules/public-lookup/repo.js", () => ({
  insertEstablishment: vi.fn(async () => {}),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { publishEstablishment: "court.public.publish_establishment" },
  EVENTS: { establishmentPublished: "court.public.establishment_published" },
}));

import { registerPublicLookupConsumers } from "../src/modules/public-lookup/consumer.js";
import * as repo from "../src/modules/public-lookup/repo.js";
import { enqueue } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function publishMsg(id: string, messageId = id) {
  return {
    messageId, type: "court.public.publish_establishment",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: {
      id, tenantId: randomUUID(), establishmentCode: "DLHC01", cnrPrefix: "DLHC01",
      courtName: "Delhi High Court", publicSlug: "delhi-high-court",
    },
  };
}

describe("public-lookup consumer", () => {
  beforeEach(() => { processedIds.clear(); vi.clearAllMocks(); });

  it("inserts the establishment and emits establishmentPublished + audit", async () => {
    const { register, deliver } = makeHarness();
    registerPublicLookupConsumers(register);
    await deliver("court.public.publish_establishment", publishMsg(randomUUID()));
    expect(repo.insertEstablishment).toHaveBeenCalledTimes(1);
    const topics = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("court.public.establishment_published");
    expect(topics).toContain("audit.event.record");
  });

  it("is exactly-once on redelivery (idempotent via markProcessed)", async () => {
    const { register, deliver } = makeHarness();
    registerPublicLookupConsumers(register);
    const m = publishMsg(randomUUID(), "fixed-id");
    await deliver("court.public.publish_establishment", m);
    await deliver("court.public.publish_establishment", m);
    expect(repo.insertEstablishment).toHaveBeenCalledTimes(1);
  });
});
