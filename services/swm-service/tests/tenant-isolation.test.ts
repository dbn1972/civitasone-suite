/**
 * Cross-tenant RLS isolation — proves the FORCE ROW LEVEL SECURITY /
 * tenant_isolation policies added in migrations/0001_swm_schema.sql actually
 * hold, using the complaints table as the representative case (every table
 * in this migration uses the identical policy shape).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { hdr, waitFor, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("tenant isolation", () => {
  it("tenant B cannot read tenant A's complaint by id, and list excludes it", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/swm/complaints",
      headers: hdr(ACTOR_A, TENANT_A, ["swm_user"]),
      payload: { complaintType: "overflow" },
    });
    expect(create.statusCode).toBe(202);
    const id = (create.json() as { id: string }).id;

    await waitFor(async () => {
      const get = await app.inject({ method: "GET", url: `/v1/swm/complaints/${id}`, headers: hdr(ACTOR_A, TENANT_A) });
      return get.statusCode === 200;
    });

    const crossTenantGet = await app.inject({
      method: "GET",
      url: `/v1/swm/complaints/${id}`,
      headers: hdr(ACTOR_A, TENANT_B),
    });
    expect(crossTenantGet.statusCode).toBe(404);

    const crossTenantList = await app.inject({
      method: "GET",
      url: "/v1/swm/complaints",
      headers: hdr(ACTOR_A, TENANT_B),
    });
    expect(crossTenantList.statusCode).toBe(200);
    expect(crossTenantList.json().data.find((c: { id: string }) => c.id === id)).toBeUndefined();
  });
});
