/**
 * analytics module — route + consumer smoke tests.
 * identify (with risk-score calculation in the consumer) -> resolve.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAnalyticsConsumers } from "../src/modules/analytics/consumer.js";
import { hdr, waitFor, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerAnalyticsConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("hotspot lifecycle: identify -> resolve", () => {
  it("computes riskScore from complaintCount in the consumer, then resolves", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/swm/hotspots",
      headers: hdr(ACTOR_A, TENANT_A, ["swm_admin"]),
      payload: { category: "illegal_dumping", complaintCount: 12 },
    });
    expect(create.statusCode).toBe(202);
    const id = (create.json() as { id: string }).id;

    let get = await app.inject({ method: "GET", url: `/v1/swm/hotspots/${id}`, headers: hdr() });
    await waitFor(async () => {
      get = await app.inject({ method: "GET", url: `/v1/swm/hotspots/${id}`, headers: hdr() });
      return get.statusCode === 200;
    });
    expect(get.json().data.status).toBe("identified");
    // calculateRiskScore: complaintCount >= 10 -> 75
    expect(get.json().data.riskScore).toBe(75);

    const resolve = await app.inject({
      method: "POST",
      url: `/v1/swm/hotspots/${id}/resolve`,
      headers: hdr(),
      payload: { version: 1 },
    });
    expect(resolve.statusCode).toBe(202);
    await waitFor(async () => {
      get = await app.inject({ method: "GET", url: `/v1/swm/hotspots/${id}`, headers: hdr() });
      return get.json().data.status === "resolved";
    });
  });

  it("rejects a non-numeric complaintCount", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/swm/hotspots",
      headers: hdr(ACTOR_A, TENANT_A, ["swm_admin"]),
      payload: { complaintCount: -1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
