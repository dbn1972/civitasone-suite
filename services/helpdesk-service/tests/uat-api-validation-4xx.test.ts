/**
 * UAT API sweep 2026-10-28 (fq10c): empty body, malformed JSON, invalid fields, bad query and malformed
 * path ids must answer 4xx, never 500.
 * Root cause: registerSchemaErrorHandler ran AFTER the route plugins were registered, so the
 * encapsulated route contexts kept the Fastify default error handler and a thrown ZodError became a 500
 * (see admin-service/tests/uat-api-validation-4xx.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000c1";
const headers = {
  authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000c1", tid: T, roles: ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin"], sid: "sess-val" }, SECRET, 3600)}`,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

/** Routes the UAT sweep reported as 5xx on a validation probe. */
const ROUTES: Array<[string, string]> = [
  ["GET", "/v1/helpdesk/road-hotspots"],
  ["GET", "/v1/helpdesk/road-hotspots/:id"],
  ["GET", "/v1/helpdesk/road-hotspots/:id/linked-tickets"],
  ["GET", "/v1/helpdesk/sanitation/complaints"],
  ["GET", "/v1/helpdesk/sanitation/complaints/:id"],
  ["GET", "/v1/helpdesk/sanitation/field-actions"],
  ["POST", "/v1/helpdesk/road-hotspots"],
  ["POST", "/v1/helpdesk/road-hotspots/:id/link-ticket"],
  ["POST", "/v1/helpdesk/road-hotspots/:id/plan-maintenance"],
  ["POST", "/v1/helpdesk/sanitation/complaints"],
  ["POST", "/v1/helpdesk/sanitation/complaints/:id/assign"],
  ["POST", "/v1/helpdesk/sanitation/complaints/:id/reopen"],
  ["POST", "/v1/helpdesk/sanitation/complaints/:id/resolve"],
  ["POST", "/v1/helpdesk/sanitation/field-actions"],
];

const url = (p: string) => p.replace(/:[A-Za-z]+/g, "not-a-uuid");
const JSON_CT = { ...headers, "content-type": "application/json" };

/**
 * Every probe is authenticated with a role that passes the route's role gate, so the expected status is exact:
 * 400 VALIDATION_FAILED for a bad query / invalid fields, 400 for an empty or malformed body.
 * The few routes whose outcome legitimately differs are listed here with the reason.
 */
type Expected = { status: number; code: string };
const OVERRIDES: Record<string, Expected & { why: string }> = {

};
const expected = (key: string, dflt: Expected): Expected => OVERRIDES[key] ?? dflt;

function check(res: { statusCode: number; body: string; json: () => { code?: string } }, want: Expected) {
  expect(res.statusCode, res.body).toBe(want.status);
  expect(res.json().code ?? "", res.body).toBe(want.code);
}

describe("helpdesk-service validation probes answer the specific 4xx, never 5xx", () => {
  for (const [method, path] of ROUTES) {
    const u = url(path);
    if (method === "GET" || method === "DELETE") {
      it(`${method} ${path} with bad query + malformed id -> 400 VALIDATION_FAILED`, async () => {
        const res = await app.inject({ method: method as "GET", url: `${u}?limit=abc&offset=-5&page=zzz&from=not-a-date`, headers });
        check(res, expected(`${method} ${path} query`, { status: 400, code: "VALIDATION_FAILED" }));
      });
      continue;
    }
    it(`${method} ${path} with an empty body -> 400`, async () => {
      const res = await app.inject({ method: method as "POST", url: u, headers: JSON_CT, payload: "" });
      expect(res.statusCode, res.body).toBe(400);
      // Fastify rejects an empty JSON body itself; the shared handler keeps its FST_ERR code (or MALFORMED_BODY).
      expect(["MALFORMED_BODY", "FST_ERR_CTP_EMPTY_JSON_BODY"], res.body).toContain(res.json().code);
    });
    it(`${method} ${path} with malformed JSON -> 400 MALFORMED_BODY`, async () => {
      const res = await app.inject({ method: method as "POST", url: u, headers: JSON_CT, payload: "{\"a\":" });
      check(res, { status: 400, code: "MALFORMED_BODY" });
    });
    it(`${method} ${path} with invalid fields -> 400 VALIDATION_FAILED`, async () => {
      const res = await app.inject({ method: method as "POST", url: u, headers, payload: { unexpected: 123, id: 42 } });
      check(res, expected(`${method} ${path} invalid`, { status: 400, code: "VALIDATION_FAILED" }));
    });
  }
});
