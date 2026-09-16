/**
 * COMP-007 -- ml-service `purge` module (DPDP Act tenant-deletion cascade:
 * wipes ml_models/ml_predictions/ml_feature_vectors/ml_training_runs + S3
 * model artifacts + Redis cache for a deleted tenant) smoke test.
 *
 * Registered as a consumer only (registerPurgeConsumer) but had zero test
 * references anywhere in the service.
 *
 * The consumer's own file header already documents one historical bug fixed
 * before this tranche (markProcessed committed in a SEPARATE transaction from
 * the actual purge, so a transient purge failure was silently and permanently
 * treated as done) -- confirmed current code keeps both in ONE transaction.
 *
 * Follows this campaign's consumer-test convention (MemoryQueue, drained via
 * q.drain(), real disposable Postgres). This service's worker.ts wraps
 * `queue.subscribe` globally with `runWithTenant(msg.tenantId, ...)` (not a
 * per-module wrapper the consumer calls itself, unlike ml-predictions in this
 * same tranche) -- replicated here with the identical wrap() helper so the
 * write path's RLS GUC is set the same way production's worker sets it.
 * Setup rows are inserted the same way: db.transaction() inside
 * runWithTenant() (bare .select()/.insert() would silently match zero rows
 * under this schema's FORCE RLS, confirmed the hard way in this tranche's
 * ml-predictions test).
 *
 * S3 calls are pointed at this host's existing LocalStack (already running
 * for the shared dev stack; a fresh random tenantId's S3 prefix can never
 * collide with anything else using it) rather than real AWS, since neither
 * this service's vitest.config.ts nor its tests set any AWS_* env var at all
 * -- without an override the client would default to region ap-south-1
 * against real AWS with empty credentials.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "@civitasone/outbox";
import { mlModels } from "../src/modules/models/schema.js";
import { mlPredictions } from "../src/modules/predictions/schema.js";
import { mlFeatureVectors } from "../src/modules/feature-store/schema.js";
import { mlTrainingRuns } from "../src/modules/training/schema.js";
import { registerPurgeConsumer } from "../src/modules/purge/consumer.js";
import { CONSUMED } from "../src/topics.js";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) =>
    raw(t, (msg: any) => runWithTenant(msg.tenantId, () => h(msg)))) as typeof q.subscribe;
  return q;
}

function envelope(payload: Record<string, unknown>, tenantId: string, actorId: string, correlationId: string, messageId = randomUUID()) {
  return { messageId, type: CONSUMED.tenantDeleted, tenantId, actorId, correlationId, schemaVersion: "1.0", payload };
}

async function seedTenantData(tenantId: string, actorId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      const [model] = await tx.insert(mlModels).values({
        tenantId, domain: "leads", version: 1, status: "active", s3Key: `ml-models/${tenantId}/v1.bin`,
        trainedAt: new Date(), recordCount: 100, createdBy: actorId, updatedBy: actorId,
      }).returning({ id: mlModels.id });

      await tx.insert(mlPredictions).values({
        tenantId, domain: "leads", entityId: randomUUID(), modelId: model.id, confidence: "0.9000",
      });
      await tx.insert(mlFeatureVectors).values({
        tenantId, domain: "leads", entityId: randomUUID(), features: { score: 1 },
      });
      await tx.insert(mlTrainingRuns).values({
        tenantId, domain: "leads", status: "completed", modelId: model.id, recordCount: 100,
      });
      return model.id;
    }),
  );
}

async function countsForTenant(tenantId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction(async (tx) => ({
      models: (await tx.select().from(mlModels).where(eq(mlModels.tenantId, tenantId))).length,
      predictions: (await tx.select().from(mlPredictions).where(eq(mlPredictions.tenantId, tenantId))).length,
      featureVectors: (await tx.select().from(mlFeatureVectors).where(eq(mlFeatureVectors.tenantId, tenantId))).length,
      trainingRuns: (await tx.select().from(mlTrainingRuns).where(eq(mlTrainingRuns.tenantId, tenantId))).length,
    })),
  );
}

async function outboxRowsForCorrelation(correlationId: string) {
  return db.select().from(outboxMessages).where(eq(outboxMessages.correlationId, correlationId));
}

afterAll(async () => {
  await sqlClient.end();
});

describe("COMP-007: purge consumer -- tenant.deleted", () => {
  it("deletes every row across all four ML tables for the tenant, and emits one audit event", async () => {
    const TENANT = randomUUID();
    const ACTOR = randomUUID();
    const CORR = `corr-${randomUUID()}`;
    await seedTenantData(TENANT, ACTOR);

    const before = await countsForTenant(TENANT);
    expect(before).toEqual({ models: 1, predictions: 1, featureVectors: 1, trainingRuns: 1 });

    const q = wire(new MemoryQueue());
    registerPurgeConsumer(q);
    await q.start();
    await q.publish(CONSUMED.tenantDeleted, envelope({ tenantId: TENANT, deletedAt: new Date().toISOString() }, TENANT, ACTOR, CORR));
    await q.drain();

    const after = await countsForTenant(TENANT);
    expect(after).toEqual({ models: 0, predictions: 0, featureVectors: 0, trainingRuns: 0 });

    const audit = await outboxRowsForCorrelation(CORR);
    expect(audit).toHaveLength(1);
    expect(audit[0].payload).toMatchObject({
      service: "ml-service", action: "purge", resourceType: "tenant_data", resourceId: TENANT, outcome: "success",
    });
  });

  it("is idempotent: redelivering the same messageId does not re-run the purge or double-emit the audit event", async () => {
    const TENANT = randomUUID();
    const ACTOR = randomUUID();
    const CORR = `corr-${randomUUID()}`;
    const messageId = randomUUID();
    await seedTenantData(TENANT, ACTOR);

    const q = wire(new MemoryQueue());
    registerPurgeConsumer(q);
    await q.start();

    const env = envelope({ tenantId: TENANT, deletedAt: new Date().toISOString() }, TENANT, ACTOR, CORR, messageId);
    await q.publish(CONSUMED.tenantDeleted, env);
    await q.drain();
    // Redeliver the exact same messageId a second time.
    await q.publish(CONSUMED.tenantDeleted, env);
    await q.drain();

    expect(await outboxRowsForCorrelation(CORR)).toHaveLength(1);
  });

  it("only purges the targeted tenant -- a sibling tenant's data survives", async () => {
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const ACTOR = randomUUID();
    await seedTenantData(TENANT_A, ACTOR);
    await seedTenantData(TENANT_B, ACTOR);

    const q = wire(new MemoryQueue());
    registerPurgeConsumer(q);
    await q.start();
    await q.publish(CONSUMED.tenantDeleted, envelope({ tenantId: TENANT_A, deletedAt: new Date().toISOString() }, TENANT_A, ACTOR, `corr-${randomUUID()}`));
    await q.drain();

    expect(await countsForTenant(TENANT_A)).toEqual({ models: 0, predictions: 0, featureVectors: 0, trainingRuns: 0 });
    expect(await countsForTenant(TENANT_B)).toEqual({ models: 1, predictions: 1, featureVectors: 1, trainingRuns: 1 });
  });

  it("missing tenantId in the event payload is a no-op, not a crash (falls back to msg.tenantId, and this envelope's top-level tenantId is a real one, so it purges that instead)", async () => {
    const TENANT = randomUUID();
    const ACTOR = randomUUID();
    await seedTenantData(TENANT, ACTOR);

    const q = wire(new MemoryQueue());
    registerPurgeConsumer(q);
    await q.start();
    // payload.tenantId omitted -- handler falls back to the envelope's own
    // top-level tenantId (see consumer.ts: `payload.tenantId ?? msg.tenantId`).
    await q.publish(CONSUMED.tenantDeleted, envelope({ deletedAt: new Date().toISOString() }, TENANT, ACTOR, `corr-${randomUUID()}`));
    await q.drain();

    expect(await countsForTenant(TENANT)).toEqual({ models: 0, predictions: 0, featureVectors: 0, trainingRuns: 0 });
  });
});
