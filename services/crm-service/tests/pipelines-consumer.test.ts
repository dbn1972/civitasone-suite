/**
 * Pipeline consumer tests.
 *
 * registerPipelineConsumers existed but was never wired into the worker, so
 * create/update/delete of a sales pipeline returned 202 and changed nothing.
 * These tests go through the route and assert the projected rows.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { drainQueue, captureHandlers } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000060";
const ACTOR = "cccccccc-3333-4000-8000-000000000060";

function auth(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-pipeline" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

function stages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    name: `Stage ${i + 1}`,
    probability: Math.round((i / (count - 1)) * 100),
    ordinal: i,
  }));
}

function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.pipelines WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

let app: FastifyInstance;

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await cleanup();
  await sqlClient.end();
});

async function createPipeline(name: string, stageCount = 4): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/pipelines",
    headers: auth(),
    payload: { name, stages: stages(stageCount) },
  });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return res.json().id as string;
}

describe("crm.pipeline.* consumers apply pipeline writes", () => {
  it("persists a created pipeline and its stages", async () => {
    const id = await createPipeline("Consumer Sales Pipeline", 5);

    const rows = await scoped((tx) => tx<Array<{
      name: string; stages: Array<{ name: string }>; status: string; version: number;
    }>>`
      SELECT name, stages, status, version FROM crm.pipelines
      WHERE id = ${id} AND tenant_id = ${TENANT}
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Consumer Sales Pipeline");
    expect(rows[0]!.stages).toHaveLength(5);
    expect(rows[0]!.status).toBe("active");
    expect(rows[0]!.version).toBe(1);

    const read = await app.inject({ method: "GET", url: `/v1/crm/pipelines/${id}`, headers: auth() });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.name).toBe("Consumer Sales Pipeline");
  });

  it("applies a rename and bumps the version", async () => {
    const id = await createPipeline("Before Rename");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/pipelines/${id}`,
      headers: auth(),
      payload: { name: "After Rename", version: 1 },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{ name: string; version: number }>>`
      SELECT name, version FROM crm.pipelines WHERE id = ${id} AND tenant_id = ${TENANT}
    `);
    expect(rows[0]!.name).toBe("After Rename");
    expect(rows[0]!.version).toBe(2);
  });

  it("ignores a rename that carries a stale version", async () => {
    const id = await createPipeline("Stale Version Target");

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/pipelines/${id}`,
      headers: auth(),
      payload: { name: "Should Not Apply", version: 99 },
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{ name: string; version: number }>>`
      SELECT name, version FROM crm.pipelines WHERE id = ${id} AND tenant_id = ${TENANT}
    `);
    expect(rows[0]!.name).toBe("Stale Version Target");
    expect(rows[0]!.version).toBe(1);
  });

  it("soft-deletes a pipeline", async () => {
    const id = await createPipeline("To Be Deleted");

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/crm/pipelines/${id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(202);
    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{ status: string }>>`
      SELECT status FROM crm.pipelines WHERE id = ${id} AND tenant_id = ${TENANT}
    `);
    expect(rows[0]!.status).not.toBe("active");
  });

  it("emits the pipeline domain events through the outbox", async () => {
    const events = await scoped((tx) => tx<Array<{ eventType: string }>>`
      SELECT event_type AS "eventType" FROM _outbox.messages WHERE tenant_id = ${TENANT}
    `);
    const types = events.map((e) => e.eventType);
    expect(types).toContain("crm.pipeline.created");
    expect(types).toContain("crm.pipeline.updated");
    expect(types).toContain("crm.pipeline.deleted");
    expect(types).toContain("audit.event.record");
  });
});

describe("pipeline STAGE_IN_USE / PIPELINE_IN_USE race guard (consumer re-check)", () => {
  async function insertOpenDeal(pipelineId: string, stage: string): Promise<void> {
    await scoped((tx) => tx`
      INSERT INTO crm.deals (id, tenant_id, pipeline_id, name, stage, value_minor, currency, status, stage_entered_at, created_by, updated_by, version)
      VALUES (${randomUUID()}, ${TENANT}, ${pipelineId}, 'Raced Deal', ${stage}, 100000, 'INR', 'active', now(), ${ACTOR}, ${ACTOR}, 1)`);
  }
  /**
   * Hold the command the route publishes instead of letting the memory queue deliver
   * it. The memory queue delivers on `setTimeout(0)` after publish(), so with the real
   * queue the consumer's re-check races the test's own INSERT of the "late" deal (a DB
   * round trip): whichever wins decided whether the removal/delete was refused or
   * applied, i.e. the test was nondeterministic. Holding the message and invoking the
   * consumer handler explicitly AFTER the deal is committed makes the interleaving the
   * test describes ("a deal lands between the route check and the consumer") exact.
   */
  async function withHeldPublishes(run: () => Promise<void>): Promise<CommandEnvelope[]> {
    const held: CommandEnvelope[] = [];
    const spy = vi.spyOn(queue, "publish").mockImplementation((async (topic: string, input: Record<string, unknown>) => {
      const messageId = (input.messageId as string | undefined) ?? randomUUID();
      held.push({ ...input, type: (input.type as string | undefined) ?? topic, messageId } as unknown as CommandEnvelope);
      return messageId;
    }) as never);
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
    return held;
  }

  async function deliverHeld(held: CommandEnvelope[]): Promise<void> {
    const { handlerFor } = captureHandlers();
    for (const msg of held) {
      await runWithTenant(msg.tenantId, () => handlerFor(msg.type)(msg));
    }
  }

  async function auditOutcomes(id: string): Promise<string[]> {
    const rows = await scoped((tx) => tx<Array<{ outcome: string }>>`
      SELECT payload->>'outcome' AS outcome FROM _outbox.messages
       WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record' AND payload->>'resourceId' = ${id}`);
    return rows.map((r) => r.outcome);
  }

  it("refuses a stage removal when a deal lands between the route check and the consumer (audited)", async () => {
    const id = await createPipeline("Race Stage Pipeline", 4);
    const current = (await scoped((tx) => tx<Array<{ stages: Array<{ id: string; name: string; probability: number; ordinal: number }> }>>`
      SELECT stages FROM crm.pipelines WHERE id = ${id} AND tenant_id = ${TENANT}`))[0]!.stages;
    const kept = current.slice(0, 3).map((s, i) => ({ ...s, ordinal: i }));
    const removedName = current[3]!.name;

    // Route pre-check passes (no deals yet) -> 202 and the command is queued ...
    const held = await withHeldPublishes(async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/crm/pipelines/${id}`, headers: auth(), payload: { version: 1, stages: kept } });
      expect(res.statusCode).toBe(202);
    });
    expect(held.length).toBeGreaterThan(0);
    // ... then a deal lands in the stage being removed BEFORE the consumer runs.
    await insertOpenDeal(id, removedName);
    await deliverHeld(held);
    await drainQueue();

    const row = (await scoped((tx) => tx<Array<{ stages: unknown[]; version: number }>>`
      SELECT stages, version FROM crm.pipelines WHERE id = ${id} AND tenant_id = ${TENANT}`))[0]!;
    expect(row.stages).toHaveLength(4); // not applied
    expect(row.version).toBe(1);
    expect(await auditOutcomes(id)).toContain("rejected_stage_in_use");
  });

  it("refuses a pipeline delete when a deal lands between the route check and the consumer (audited)", async () => {
    const id = await createPipeline("Race Delete Pipeline", 4);
    const held = await withHeldPublishes(async () => {
      const res = await app.inject({ method: "DELETE", url: `/v1/crm/pipelines/${id}`, headers: auth() });
      expect(res.statusCode).toBe(202);
    });
    expect(held.length).toBeGreaterThan(0);
    await insertOpenDeal(id, "Stage 1");
    await deliverHeld(held);
    await drainQueue();

    const row = (await scoped((tx) => tx<Array<{ status: string }>>`
      SELECT status FROM crm.pipelines WHERE id = ${id} AND tenant_id = ${TENANT}`))[0]!;
    expect(row.status).toBe("active");
    expect(await auditOutcomes(id)).toContain("rejected_pipeline_in_use");
  });
});
