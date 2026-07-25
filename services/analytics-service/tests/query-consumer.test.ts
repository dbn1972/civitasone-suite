/**
 * QUERY CONSUMER end-to-end — proves the real write path: a command is consumed,
 * the whitelisted query executes (tenant-scoped, parameterised) and the result
 * is persisted to query_runs. A bad spec produces a recorded 'failed' run rather
 * than crashing or running raw SQL.
 *
 * civitas_analytics runs under the NOBYPASSRLS analytics_svc role, so every
 * fact_events / query_runs access is gated by the tenant_isolation RLS policy
 * (tenant_id = current_setting('app.tenant_id')). In production worker.ts wraps
 * every subscription handler in runWithTenant(msg.tenantId); here we wrap the
 * in-memory queue the same way so the consumer's scopedRead / db.transaction set
 * the GUC exactly as they do at runtime.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { factEvents } from "../src/modules/facts/schema.js";
import { queryRuns } from "../src/modules/queries/schema.js";
import * as factsRepo from "../src/modules/facts/repo.js";
import * as queriesRepo from "../src/modules/queries/repo.js";
import { registerQueriesConsumers } from "../src/modules/queries/consumer.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

// Wrap the in-memory queue so every delivered message runs inside its tenant's
// AsyncLocalStorage context — the same thing worker.ts does in production, which
// is what makes the consumer's scopedRead / db.transaction set app.tenant_id.
const base = new MemoryQueue();
const queue = {
  subscribe(topic: string, handler: (msg: { tenantId: string }) => Promise<void> | void) {
    return base.subscribe(topic, (msg: { tenantId: string }) =>
      runWithTenant(msg.tenantId, () => handler(msg)),
    );
  },
  publish(topic: string, msg: unknown) {
    return base.publish(topic, msg);
  },
  start() {
    return base.start();
  },
  stop() {
    return base.stop();
  },
} as unknown as MemoryQueue;

function publishRun(id: string, spec: Record<string, unknown>) {
  return queue.publish("analytics.query.run", {
    messageId: id,
    type: "analytics.query.run",
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "c1",
    schemaVersion: "1.0",
    payload: { id, tenantId: TENANT, dashboardId: null, queryName: "test", status: "running", kind: "adhoc", spec, result: null, resultRows: 0, error: null, version: 1 },
  });
}

async function waitForRun(id: string, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await runWithTenant(TENANT, () => queriesRepo.findById(id, TENANT));
    if (run && run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 40));
  }
  return runWithTenant(TENANT, () => queriesRepo.findById(id, TENANT));
}

beforeAll(async () => {
  registerQueriesConsumers(queue);
  await queue.start();
  // amount is a minor-unit BIGINT (never a decimal string). Seed inside the
  // tenant's GUC context + a write tx, mirroring the facts consumer.
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      factsRepo.ingest(tx, {
        tenantId: TENANT,
        source: "finance",
        eventType: "payment.released",
        category: "general",
        status: "recorded",
        amount: 250n,
        occurredAt: new Date(),
        dedupeKey: randomUUID(),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
});

afterAll(async () => {
  await queue.stop();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(queryRuns).where(eq(queryRuns.tenantId, TENANT));
      await tx.delete(factEvents).where(eq(factEvents.tenantId, TENANT));
    }),
  );
  await sqlClient.end();
});

describe("runQuery consumer", () => {
  it("executes a valid spec and persists a completed run with the computed result", async () => {
    const id = randomUUID();
    await publishRun(id, { metric: "amount_sum", dimensions: ["source"], filters: [], limit: 100 });
    const run = await waitForRun(id);
    expect(run?.status).toBe("completed");
    expect(run?.error).toBeNull();
    const result = run?.result as { rows: Array<{ source: string; value: number }> };
    expect(result.rows).toEqual([{ source: "finance", value: 250 }]);
  });

  it("records a failed run for a non-whitelisted metric (never raw SQL, never a crash)", async () => {
    const id = randomUUID();
    await publishRun(id, { metric: "drop_tables", dimensions: [], filters: [], limit: 100 });
    const run = await waitForRun(id);
    expect(run?.status).toBe("failed");
    expect(run?.error ?? "").toContain("metric");
  });
});
