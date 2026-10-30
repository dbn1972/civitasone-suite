/**
 * UAT W8-C (live API sweep): GET /v1/reports/dashboards?limit=abc&offset=-5 answered 500.
 * registerSchemaErrorHandler ran AFTER the route plugins, so the ZodError from listQuerySchema in the
 * dashboard module (no handler of its own) fell through to Fastify's default 500. It is a 400 now.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "8c000000-0000-4000-8000-0000000006a1";
const ACTOR = "8c000000-0000-4000-8000-0000000006c3";
const headers = {
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["super_admin", "report_admin"], sid: "s-w8c" }, SECRET, 3600)}`,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/reports/dashboards", () => {
  for (const qs of ["limit=abc&offset=-5", "limit=abc", "offset=-5", "limit=0"]) {
    it(`?${qs} -> 400 VALIDATION_FAILED, not a ZodError 500`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/reports/dashboards?${qs}`, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
  it("a valid query still answers 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/reports/dashboards?limit=5", headers });
    expect(res.statusCode).toBe(200);
  });
});
