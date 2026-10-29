/**
 * Real-DB regression for UAT FQ12 #64 #65: PUT /v1/plugins/:pluginId/store/:key
 * persisted the row (consumer runs under the tenant GUC), but GET and DELETE read
 * it back with a bare db.select() against FORCE RLS store.plugin_stores, matched
 * zero rows and answered 404. The quota sum was likewise always 0.
 *
 * The PUT/DELETE commands are captured and delivered to the real consumers after
 * a JSON round-trip, under the message tenant (as worker.ts does).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerStoreConsumers } from "../src/modules/store/consumer.js";
import { pluginStores } from "../src/modules/store/schema.js";
import * as repo from "../src/modules/store/repo.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const PLUGIN = randomUUID();
const auth = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["plugin_admin"], sid: "sess-fq12" }, SECRET, 3600)}` };

type Handler = (msg: CommandEnvelope) => Promise<void>;
const handlers = new Map<string, Handler[]>();
const broker = {
  subscribe: (topic: string, h: Handler) => { handlers.set(topic, [...(handlers.get(topic) ?? []), h]); },
  publish: async () => randomUUID(),
  start: async () => {}, stop: async () => {},
  healthCheck: async () => ({ healthy: true, driver: "memory" as const }),
} as unknown as Queue;
const published: Array<{ topic: string; msg: CommandEnvelope }> = [];

async function deliverAll(): Promise<void> {
  for (const { topic, msg } of published.splice(0)) {
    const wire = JSON.parse(JSON.stringify(msg)) as CommandEnvelope;
    for (const h of handlers.get(topic) ?? []) await runWithTenant(wire.tenantId, () => h(wire));
  }
}

let app: FastifyInstance;

beforeAll(async () => {
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, input: unknown) => {
    const msg = input as CommandEnvelope;
    published.push({ topic, msg });
    return msg.messageId ?? randomUUID();
  });
  registerStoreConsumers(broker);
  app = await buildApp();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.delete(pluginStores).where(eq(pluginStores.tenantId, TENANT)))).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("UAT FQ12 #64/#65 plugin store read-back under FORCE RLS", () => {
  it("GET returns what PUT stored; usage is counted; DELETE removes it", async () => {
    const url = `/v1/plugins/${PLUGIN}/store/fq12-key`;
    const put = await app.inject({ method: "PUT", url, headers: auth, payload: { value: { theme: "dark", n: 3 } } });
    expect(put.statusCode).toBe(202);
    await deliverAll();

    // #64: GET by the same tenant sees the row.
    const got = await app.inject({ method: "GET", url, headers: auth });
    expect(got.statusCode).toBe(200);
    expect(got.json().data.value).toEqual({ theme: "dark", n: 3 });
    expect(typeof got.json().data.updatedAt).toBe("string");
    expect(await repo.getTotalUsageBytes(TENANT, PLUGIN)).toBeGreaterThan(0);

    // Another tenant still cannot see it (scoping comes from the caller's tenant).
    expect(await repo.getTotalUsageBytes(randomUUID(), PLUGIN)).toBe(0);

    // #65: DELETE finds the row (was 404) and the consumer removes it.
    const del = await app.inject({ method: "DELETE", url, headers: auth });
    expect(del.statusCode).toBe(202);
    await deliverAll();
    const left = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(pluginStores)
      .where(and(eq(pluginStores.tenantId, TENANT), eq(pluginStores.pluginId, PLUGIN)))));
    expect(left).toHaveLength(0);
    const gone = await app.inject({ method: "GET", url, headers: auth });
    expect(gone.statusCode).toBe(404);
  });
});
