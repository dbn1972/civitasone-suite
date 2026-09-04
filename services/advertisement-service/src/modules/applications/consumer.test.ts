/**
 * Real, DB-backed applications tests — route → consumer → persisted-state.
 *
 * Replaces the previous fully vi.mock'd consumer.test.ts (db.js, outbox.js,
 * repo.js, infra.js were all mocked; nothing ever touched Postgres). CI now
 * bootstraps + migrates a real database for this service (PR #1000), so
 * these run the full command pipeline for real: POST through the actual
 * Fastify app, off the actual (in-process MemoryQueue-backed) command bus,
 * through the actual registered consumer, into the actual Postgres table —
 * then assert on the row via repo.findById, not on a mock call.
 *
 * Also covers two of this branch's own fixes:
 *  - the areaInSqFt bound + widthFt×heightFt cross-check (applications/routes.ts)
 *  - the collision-prone `Date.now() % 999999` application-number generator,
 *    replaced with a real Postgres SEQUENCE (migrations/0003_number_sequences.sql,
 *    applications/repo.ts nextApplicationNumberSeq)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { queue } from "../../shared/infra.js";
import { sqlClient } from "../../shared/db.js";
import { registerApplicationConsumers } from "./consumer.js";
import * as repo from "./repo.js";
import { tokenForTenant, settle } from "../../shared/test-helpers.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const ADV_ROLES = ["adv_user"];

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  registerApplicationConsumers(queue);
  await queue.start();
  app = await buildApp();
  token = tokenForTenant(TENANT, ACTOR, ADV_ROLES);
});

afterAll(async () => {
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    advertiserName: "Acme Ads",
    advertiserOrg: "Acme Pvt Ltd",
    advertisementType: "banner",
    location: { address: "MG Road", ward: "12" },
    dimensions: { widthFt: 20, heightFt: 10, areaInSqFt: 200 },
    ...overrides,
  };
}

describe("POST /v1/advertisement/applications — route → consumer → persisted row", () => {
  it("202-accepts, and the consumer persists a draft row with the computed fee and a generated application number", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/advertisement/applications",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: createPayload(),
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json() as { id: string };
    expect(id).toBeDefined();

    await settle();
    const row = await repo.findById(id, TENANT);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("draft");
    // banner rate: 3000n paise/sqft * 200 sqft = 600000n (above the 500000n floor)
    expect(row!.feeMinor).toBe(600000n);
    expect(row!.applicationNumber).toMatch(/^ADV\/ULB\/\d{4}\/\d{6}$/);
    expect(row!.feePaid).toBe(false);
  });

  it("two applications created back-to-back get distinct, non-colliding application numbers (collision-prone-generator regression)", async () => {
    // Before this branch's fix, both of these computed their sequence as
    // Date.now() % 999999 OUTSIDE the write transaction — two commands
    // published close together could compute the identical value, and the
    // UNIQUE constraint on application_number would then throw inside the
    // SECOND consumer's transaction, rolling it back entirely (a silent
    // failure after the route had already returned 202). Publishing both
    // concurrently is the most direct way to exercise that timing window;
    // nextval() on migrations/0003_number_sequences.sql's sequence is
    // atomic regardless.
    const [resA, resB] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/advertisement/applications",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: createPayload(),
      }),
      app.inject({
        method: "POST",
        url: "/v1/advertisement/applications",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: createPayload(),
      }),
    ]);
    expect(resA.statusCode).toBe(202);
    expect(resB.statusCode).toBe(202);
    const idA = (resA.json() as { id: string }).id;
    const idB = (resB.json() as { id: string }).id;

    await settle();
    const rowA = await repo.findById(idA, TENANT);
    const rowB = await repo.findById(idB, TENANT);
    // Both rows must have actually persisted (proves neither consumer
    // transaction was rolled back by a spurious UNIQUE-constraint collision)
    // and their generated numbers must differ.
    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();
    expect(rowA!.applicationNumber).not.toBe(rowB!.applicationNumber);
  });

  it("rejects an areaInSqFt that doesn't match widthFt × heightFt (400, before 202)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/advertisement/applications",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: createPayload({ dimensions: { widthFt: 20, heightFt: 10, areaInSqFt: 5000 } }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an areaInSqFt above the bound even when internally consistent (400, before 202)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/advertisement/applications",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: createPayload({ dimensions: { widthFt: 300, heightFt: 300, areaInSqFt: 90000 } }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts areaInSqFt within a reasonable tolerance of widthFt × heightFt", async () => {
    // 20 * 10 = 200 exactly; 205 is within the 10% tolerance.
    const res = await app.inject({
      method: "POST",
      url: "/v1/advertisement/applications",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: createPayload({ dimensions: { widthFt: 20, heightFt: 10, areaInSqFt: 205 } }),
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /v1/advertisement/applications/:id/submit — pre-accept validation", () => {
  it("404s for a non-existent application", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/advertisement/applications/${randomUUID()}/submit`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202-accepts a draft application, and the consumer moves it to submitted", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/advertisement/applications",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: createPayload(),
    });
    const { id } = create.json() as { id: string };
    await settle();

    const submit = await app.inject({
      method: "POST",
      url: `/v1/advertisement/applications/${id}/submit`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(submit.statusCode).toBe(202);
    await settle();

    const row = await repo.findById(id, TENANT);
    expect(row!.status).toBe("submitted");
    expect(row!.submittedAt).not.toBeNull();
  });
});
