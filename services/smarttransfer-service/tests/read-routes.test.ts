/**
 * SmartTransfer read routes + command-id isolation (real Postgres).
 *
 * - GET /cycles/:id: found, cross-jurisdiction 404 (same predicate as the list),
 *   and the tenant-keyed read-through cache can never serve a row to a caller
 *   whose jurisdiction scope would hide it.
 * - Role denial on every GET route (citizen is never staff).
 * - x-idempotency-key: the deterministic command id is seeded with tenant and
 *   actor, so two tenants (or two actors) reusing one key never collide on
 *   markProcessed, while a true retry by the same caller still dedupes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMovementConsumers } from "../src/modules/movement/consumer.js";
import { cycles } from "../src/modules/movement/schema.js";
import { authHeader, stubCompositionFetch } from "./_helpers.js";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const OTHER_ACTOR = randomUUID();
const JURIS_A = randomUUID();
const JURIS_B = randomUUID();

let app: FastifyInstance;
let restoreFetch: () => void;

beforeAll(async () => {
  restoreFetch = stubCompositionFetch(() => ({ configured: true, data: [{ name: "smarttransfer" }] }));
  app = await buildApp();
  await app.ready();
  registerMovementConsumers(queue);
});

afterAll(async () => {
  restoreFetch();
  await app.close();
  await sqlClient.end();
});

function body(name: string) {
  return {
    name,
    movementTypeId: randomUUID(),
    calendar: {
      opensAt: "2026-01-01T00:00:00.000Z",
      freezesAt: "2026-02-01T00:00:00.000Z",
      closesAt: "2026-03-01T00:00:00.000Z",
    },
  };
}

async function createCycle(
  tenant: string,
  actor: string,
  juris: string[],
  name: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ commandId: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/smarttransfer/cycles",
    headers: { ...authHeader(tenant, actor, ["smarttransfer_admin"], juris), ...extraHeaders },
    payload: body(name),
  });
  expect(res.statusCode).toBe(202);
  await queue.drain();
  return res.json() as { commandId: string };
}

async function rowsFor(tenant: string, name: string) {
  return runWithTenant(tenant, () =>
    db.transaction((tx) => tx.select().from(cycles).where(eq(cycles.tenantId, tenant))),
  ).then((r) => r.filter((c) => c.name === name));
}

describe("GET /v1/smarttransfer/cycles/:id", () => {
  let cycleId: string;

  beforeAll(async () => {
    await createCycle(TENANT, ACTOR, [JURIS_A], "Scoped cycle");
    const rows = await rowsFor(TENANT, "Scoped cycle");
    expect(rows.length).toBe(1);
    cycleId = rows[0]!.id;
  });

  it("returns the cycle to a caller in its jurisdiction", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/smarttransfer/cycles/${cycleId}`,
      headers: authHeader(TENANT, ACTOR, ["smarttransfer_user"], [JURIS_A]),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { id: string } }).data.id).toBe(cycleId);
  });

  it("returns 404 to a staff user outside the cycle's jurisdiction, even after an in-scope read warmed the cache", async () => {
    // Warm the cache with an in-scope read first (the cache key is tenant+id).
    const warm = await app.inject({
      method: "GET",
      url: `/v1/smarttransfer/cycles/${cycleId}`,
      headers: authHeader(TENANT, ACTOR, ["smarttransfer_admin"], [JURIS_A]),
    });
    expect(warm.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/v1/smarttransfer/cycles/${cycleId}`,
      headers: authHeader(TENANT, OTHER_ACTOR, ["smarttransfer_admin"], [JURIS_B]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("a caller with no jurisdiction claim (tenant-level) can read it", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/smarttransfer/cycles/${cycleId}`,
      headers: authHeader(TENANT, OTHER_ACTOR, ["smarttransfer_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 404 to another tenant", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/smarttransfer/cycles/${cycleId}`,
      headers: authHeader(OTHER_TENANT, OTHER_ACTOR, ["smarttransfer_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("role denial on every GET route (citizen is never staff)", () => {
  const urls = [
    "/v1/smarttransfer/cycles",
    `/v1/smarttransfer/cycles/${randomUUID()}`,
    `/v1/smarttransfer/commands/${randomUUID()}`,
  ];
  for (const url of urls) {
    it(`403 for a citizen on GET ${url.replace(/[0-9a-f-]{36}/, ":id")}`, async () => {
      const res = await app.inject({
        method: "GET",
        url,
        headers: authHeader(TENANT, ACTOR, ["citizen"], [JURIS_A]),
      });
      expect(res.statusCode).toBe(403);
    });
    it(`401 without a token on GET ${url.replace(/[0-9a-f-]{36}/, ":id")}`, async () => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    });
  }
});

describe("x-idempotency-key command-id isolation", () => {
  it("two tenants reusing the SAME key get distinct command ids and BOTH commands run", async () => {
    const key = `shared-key-${randomUUID()}`;
    const a = await createCycle(TENANT, ACTOR, [JURIS_A], "Key tenant A", { "x-idempotency-key": key });
    const b = await createCycle(OTHER_TENANT, OTHER_ACTOR, [JURIS_B], "Key tenant B", { "x-idempotency-key": key });
    expect(a.commandId).not.toBe(b.commandId);
    expect((await rowsFor(TENANT, "Key tenant A")).length).toBe(1);
    expect((await rowsFor(OTHER_TENANT, "Key tenant B")).length).toBe(1);

    // Each tenant sees its own command as succeeded - not another tenant's resourceId.
    for (const [tenant, actor, juris, c] of [
      [TENANT, ACTOR, JURIS_A, a],
      [OTHER_TENANT, OTHER_ACTOR, JURIS_B, b],
    ] as const) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/smarttransfer/commands/${c.commandId}`,
        headers: authHeader(tenant, actor, ["smarttransfer_admin"], [juris]),
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { status: string } }).data.status).toBe("succeeded");
    }
  });

  it("two actors in one tenant reusing the same key get distinct command ids", async () => {
    const key = `actor-key-${randomUUID()}`;
    const a = await createCycle(TENANT, ACTOR, [JURIS_A], "Key actor 1", { "x-idempotency-key": key });
    const b = await createCycle(TENANT, OTHER_ACTOR, [JURIS_A], "Key actor 2", { "x-idempotency-key": key });
    expect(a.commandId).not.toBe(b.commandId);
    expect((await rowsFor(TENANT, "Key actor 1")).length).toBe(1);
    expect((await rowsFor(TENANT, "Key actor 2")).length).toBe(1);
  });

  it("a genuine retry by the same caller with the same key still dedupes to one row", async () => {
    const key = `retry-key-${randomUUID()}`;
    const first = await createCycle(TENANT, ACTOR, [JURIS_A], "Key retry", { "x-idempotency-key": key });
    const second = await createCycle(TENANT, ACTOR, [JURIS_A], "Key retry", { "x-idempotency-key": key });
    expect(second.commandId).toBe(first.commandId);
    expect((await rowsFor(TENANT, "Key retry")).length).toBe(1);
  });
});
