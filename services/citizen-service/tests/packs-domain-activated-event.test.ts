/**
 * GAP-INSTALL-DOMAIN-PACKS-01 / -04 (owner decision #28): citizen-service closes the
 * fire-and-forget loop by emitting `citizen.pack.domain_activated` in the SAME transaction that
 * imports the drafts, so install-service can mark its Stage 3 row completed or failed.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPacksConsumers } from "../src/modules/packs/consumer.js";
import { COMMANDS } from "../src/topics.js";

registerPacksConsumers(queue);
await queue.start();

const TOPIC = "citizen.pack.domain_activated";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "00000000-0000-0000-0000-000000000099";

type ActivatedEvent = {
  activationId: string; stageId?: string; domainPackKey: string;
  outcome: "completed" | "failed"; draftIds: string[]; reason?: string;
};

async function activatedEvents(activationId: string): Promise<ActivatedEvent[]> {
  return runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      const r = await (tx as unknown as typeof db).execute(
        sql`SELECT payload FROM _outbox.messages
            WHERE tenant_id = ${TENANT} AND topic = ${TOPIC}
              AND payload->>'activationId' = ${activationId}`,
      );
      const rows = ((r as unknown as { rows?: unknown[] }).rows ?? (r as unknown as unknown[])) as Array<{ payload: ActivatedEvent }>;
      return rows.map((x) => x.payload);
    }),
  );
}

async function waitEvents(activationId: string, ms = 8_000): Promise<ActivatedEvent[]> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const ev = await activatedEvents(activationId);
    if (ev.length > 0) return ev;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
}

function publishActivate(activationId: string, stageId: string, domainPackKey: string, messageId = activationId) {
  return queue.publish(COMMANDS.packDomainActivate, {
    messageId, type: COMMANDS.packDomainActivate,
    tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${activationId}`, schemaVersion: "1.0",
    payload: { id: activationId, tenantId: TENANT, domainPackKey, stageNumber: 3, stageId, source: "install_stage_3" },
  });
}

describe("citizen.pack.domain_activated completion event (owner decision #28)", () => {
  afterAll(async () => { await sqlClient.end(); });

  it("emits a completed event carrying the activation id, stage id and imported draft ids", async () => {
    const activationId = randomUUID();
    const stageId = randomUUID();
    await publishActivate(activationId, stageId, "municipal-in-v1");
    const events = await waitEvents(activationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ activationId, stageId, domainPackKey: "municipal-in-v1", outcome: "completed" });
    expect(events[0]!.draftIds.length).toBeGreaterThanOrEqual(3);
  }, 40_000);

  it("emits a failed event (with a reason) when no draft could be imported", async () => {
    const activationId = randomUUID();
    const stageId = randomUUID();
    await publishActivate(activationId, stageId, "does-not-exist-v9");
    const events = await waitEvents(activationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ activationId, stageId, outcome: "failed", reason: "no_drafts_imported" });
    expect(events[0]!.draftIds).toEqual([]);
  }, 40_000);

  it("a redelivered command (same messageId) emits no second event", async () => {
    const activationId = randomUUID();
    const stageId = randomUUID();
    await publishActivate(activationId, stageId, "municipal-in-v1");
    await waitEvents(activationId);
    await publishActivate(activationId, stageId, "municipal-in-v1");
    await new Promise((r) => setTimeout(r, 1500));
    expect(await activatedEvents(activationId)).toHaveLength(1);
  }, 40_000);
});
