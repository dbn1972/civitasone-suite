/**
 * Cross-service asset-handover loop.
 * works-service emits `works.asset.handover` on a completion-type work closure;
 * asset-service registers the handed-over public asset. Verifies persistence,
 * the correct derived asset identity, and idempotency on redelivery.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { assetAssets } from "../src/modules/register/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerWorksHandoverConsumers } from "../src/modules/register/handover-consumer.js";
import { uuidV5 } from "../src/shared/ids.js";
import { CONSUMED_EVENTS, EVENTS } from "../src/topics.js";

const ACTOR  = "00000000-aaaa-4000-8000-000000000009";
const TENANT = "11111111-aaaa-4000-8000-000000000009";
const WORK_ID = "aa11bb22-cc33-4d44-8e55-ff6677889900";
const HANDOVER_MSG = "99999999-1111-4000-8000-000000000009";

const ASSET_ID  = uuidV5(`works-handover:${WORK_ID}`);
const DEDUPE_ID = uuidV5(`msg:works-handover:${WORK_ID}`);


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * #146: the asset_svc role is NOBYPASSRLS and every domain table (and the
 * outbox) has FORCE RLS with policy `tenant_id = current_tenant_id()`. Raw
 * test reads/cleanup must therefore run inside a tenant-GUC transaction —
 * the drizzle-side mirror of telephony's sqlAsTenant test helper (PR #152).
 */
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

async function cleanup() {
  await asTenant(TENANT, async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(assetAssets).where(eq(assetAssets.id, ASSET_ID));
    await tx.delete(processed).where(eq(processed.messageId, DEDUPE_ID));
  });
}

function handoverEnvelope() {
  return {
    messageId: HANDOVER_MSG,
    type: CONSUMED_EVENTS.worksAssetHandover,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "corr-handover",
    schemaVersion: "1.0",
    payload: {
      workId: WORK_ID,
      tenantId: TENANT,
      name: "District Road Phase-1",
      code: "PWD/2026/0042",
      acquisitionCostMinor: "7500000",
      acquisitionDate: "2026-07-25",
      closureType: "completion",
    },
  };
}

describe("asset-service — works.asset.handover consumer", () => {
  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await sqlClient.end(); });

  it("registers the handed-over asset and records the asset.created event", async () => {
    const q = new MemoryQueue();
    registerWorksHandoverConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.worksAssetHandover, handoverEnvelope());
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await asTenant(TENANT, (tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, ASSET_ID)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("District Road Phase-1");
    expect(rows[0]?.code).toBe("PWD/2026/0042");
    expect(rows[0]?.assetType).toBe("infra");
    expect(rows[0]?.acquisitionCost).toBe(7500000n);
    expect(rows[0]?.bookValue).toBe(7500000n);
    expect(rows[0]?.projectRef).toBe(`works:${WORK_ID}`);

    const seen = await asTenant(TENANT, (tx) => tx.select().from(processed).where(eq(processed.messageId, DEDUPE_ID)));
    expect(seen).toHaveLength(1);

    const outbox = await asTenant(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
    expect(outbox.map((r) => r.eventType)).toContain(EVENTS.assetCreated);
  });

  it("is idempotent — a redelivered handover creates no duplicate asset", async () => {
    const q = new MemoryQueue();
    registerWorksHandoverConsumers(q);
    await q.start();

    await q.publish(CONSUMED_EVENTS.worksAssetHandover, handoverEnvelope());
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();

    const rows = await asTenant(TENANT, (tx) => tx.select().from(assetAssets).where(eq(assetAssets.id, ASSET_ID)));
    expect(rows).toHaveLength(1);
  });
});
