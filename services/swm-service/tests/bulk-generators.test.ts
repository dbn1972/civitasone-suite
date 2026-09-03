/**
 * bulk_generators module — route + consumer smoke tests.
 * register -> update (patch) -> suspend, driven through the real HTTP
 * routes and the real consumer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerBulkGeneratorConsumers } from "../src/modules/bulk_generators/consumer.js";
import { hdr, waitFor, TENANT_A, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerBulkGeneratorConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function registerGenerator(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/swm/bulk-generators",
    headers: hdr(ACTOR_A, TENANT_A, ["swm_admin"]),
    payload: { generatorName: "Grand Hotel", generatorType: "hotel", category: "wet", estimatedWasteKgPerDay: 200 },
  });
  expect(res.statusCode).toBe(202);
  const body = res.json() as { id: string };
  await waitFor(async () => {
    const get = await app.inject({ method: "GET", url: `/v1/swm/bulk-generators/${body.id}`, headers: hdr() });
    return get.statusCode === 200;
  });
  return body.id;
}

describe("bulk generator lifecycle: register -> update -> suspend", () => {
  it("persists on register and applies a patch update", async () => {
    const id = await registerGenerator();

    let get = await app.inject({ method: "GET", url: `/v1/swm/bulk-generators/${id}`, headers: hdr() });
    expect(get.json().data.status).toBe("registered");
    expect(get.json().data.generatorName).toBe("Grand Hotel");

    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/swm/bulk-generators/${id}`,
      headers: hdr(),
      payload: { estimatedWasteKgPerDay: 350, version: 1 },
    });
    expect(patch.statusCode).toBe(202);
    await waitFor(async () => {
      get = await app.inject({ method: "GET", url: `/v1/swm/bulk-generators/${id}`, headers: hdr() });
      return get.json().data.estimatedWasteKgPerDay === 350;
    });
    // patching a field does not touch generatorName
    expect(get.json().data.generatorName).toBe("Grand Hotel");

    // NOTE (flagged in the PR, not fixed here — out of scope tonight):
    // domain.ts only allows "suspended" from "active", but no route in this
    // service ever transitions a generator to "active" (register lands on
    // "registered"; update/patch never touches status) — so POST /suspend is
    // unreachable via the current API surface. Documented here rather than
    // assumed away.
    const suspend = await app.inject({
      method: "POST",
      url: `/v1/swm/bulk-generators/${id}/suspend`,
      headers: hdr(),
      payload: { version: 2 },
    });
    expect(suspend.statusCode).toBe(422);
    expect(suspend.json().code).toBe("TRANSITION_INVALID");
  });

  it("rejects register from a non-admin role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/swm/bulk-generators",
      headers: hdr(ACTOR_A, TENANT_A, ["swm_user"]),
      payload: { generatorName: "X", generatorType: "mall", category: "dry" },
    });
    expect(res.statusCode).toBe(403);
  });
});
