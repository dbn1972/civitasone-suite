/**
 * Pipeline consumer tests.
 *
 * registerPipelineConsumers existed but was never wired into the worker, so
 * create/update/delete of a sales pipeline returned 202 and changed nothing.
 * These tests go through the route and assert the projected rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

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
