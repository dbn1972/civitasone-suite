/**
 * GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-02: besides the ownership
 * scoping pinned in authz-counter-track-ownership.test.ts, sequential guessing
 * of tracking numbers is bounded per client (30 lookups / minute, then 429).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const CITIZEN = randomUUID();
const headers = {
  authorization: `Bearer ${signToken({ sub: CITIZEN, tid: TENANT, roles: ["citizen"], sid: "s" }, SECRET, 3600)}`,
  "x-tenant-id": TENANT,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/citizen/intake/track/:trackingNo — enumeration is rate limited", () => {
  it("answers 404 for unknown numbers up to the budget, then 429", async () => {
    // remoteAddress off the limiter allow-list (127.0.0.1 is exempt) so the budget is actually enforced
    const lookup = (n: number) => app.inject({
      method: "GET", url: `/v1/citizen/intake/track/CIT-2026-${String(900000 + n)}`, headers, remoteAddress: "172.16.9.9",
    });
    for (let i = 0; i < 30; i++) expect((await lookup(i)).statusCode).toBe(404);
    expect((await lookup(31)).statusCode).toBe(429);
  });
});
