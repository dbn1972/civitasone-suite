/**
 * GAP-GRANTS-SCHEMES-NEW-03 (UAT B4): a scheme's sector and description are
 * persisted by the schemeCreate/schemeUpdate consumers and returned by
 * GET /v1/grants/schemes/:id, so what the clerk types on the create form is
 * shown back on the scheme detail page.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerSchemeConsumers } from "../src/modules/scheme/consumer.js";
import { createSchemeBody, updateSchemeBody } from "../src/modules/scheme/validators.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
const scoped = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

async function send(q: Queue, topic: string, payload: Record<string, unknown>) {
  const messageId = randomUUID();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await scoped((tx) => tx.select().from(processed).where(eq(processed.messageId, messageId)));
    if (rows.length === 1) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`message on ${topic} was never processed`);
}

afterAll(async () => {
  await scoped((tx) => tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, TENANT)));
  await sqlClient.end();
});

describe("scheme sector/description validation", () => {
  const base = { code: "AGRI-1", name: "Farm Support", budgetMinor: 1000, maxAmountMinor: 100 };
  it("accepts a known sector and a description on create", () => {
    const r = createSchemeBody.safeParse({ ...base, sector: "agriculture", description: "Input subsidy" });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown sector", () => {
    expect(createSchemeBody.safeParse({ ...base, sector: "casino" }).success).toBe(false);
  });
  it("rejects an over-long description", () => {
    expect(createSchemeBody.safeParse({ ...base, description: "x".repeat(2001) }).success).toBe(false);
  });
  it("allows updating only the sector", () => {
    expect(updateSchemeBody.safeParse({ sector: "health" }).success).toBe(true);
  });
});

describe("scheme sector/description persistence", () => {
  it("create then update stores both fields and GET returns them", async () => {
    const q = wire(new MemoryQueue());
    registerSchemeConsumers(q);
    const id = randomUUID();
    await send(q, COMMANDS.schemeCreate, {
      id, tenantId: TENANT, code: `B4-${id.slice(0, 6)}`, name: "Farm Support Scheme",
      budgetMinor: 1_000_000, minAmountMinor: 0, maxAmountMinor: 100_000,
      sector: "agriculture", description: "Input subsidy for small farmers",
    });
    const [row] = await scoped((tx) => tx.select().from(grantSchemes).where(eq(grantSchemes.id, id)));
    expect(row?.sector).toBe("agriculture");
    expect(row?.description).toBe("Input subsidy for small farmers");

    await send(q, COMMANDS.schemeUpdate, { id, tenantId: TENANT, updatedBy: ACTOR, sector: "health", description: "Revised" });
    const [after] = await scoped((tx) => tx.select().from(grantSchemes).where(eq(grantSchemes.id, id)));
    expect(after?.sector).toBe("health");
    expect(after?.description).toBe("Revised");

    const app = await buildApp();
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["grant_officer"], sid: "s-b4" }, SECRET, 3600);
    const res = await app.inject({ method: "GET", url: `/v1/grants/schemes/${id}`, headers: { authorization: `Bearer ${token}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sector: "health", description: "Revised" });
  });

  it("a scheme created without them reads back null", async () => {
    const q = wire(new MemoryQueue());
    registerSchemeConsumers(q);
    const id = randomUUID();
    await send(q, COMMANDS.schemeCreate, {
      id, tenantId: TENANT, code: `B4N-${id.slice(0, 6)}`, name: "Plain Scheme",
      budgetMinor: 1000, minAmountMinor: 0, maxAmountMinor: 100,
    });
    const [row] = await scoped((tx) => tx.select().from(grantSchemes).where(eq(grantSchemes.id, id)));
    expect(row?.sector).toBeNull();
    expect(row?.description).toBeNull();
  });
});
