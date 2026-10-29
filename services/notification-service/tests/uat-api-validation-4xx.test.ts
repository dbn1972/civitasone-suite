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
  authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000c1", tid: T, roles: ["notification_user", "notification_admin", "super_admin"], sid: "sess-val" }, SECRET, 3600)}`,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

/** NOTE: GET /notifications/stream is an SSE endpoint (never completes under inject) and is intentionally not probed here. */
/** Routes the UAT sweep reported as 5xx on a validation probe. */
const ROUTES: Array<[string, string]> = [
  ["GET", "/notifications/campaigns"],
  ["GET", "/notifications/campaigns/:id"],
  ["GET", "/notifications/campaigns/:id/metrics"],
  ["GET", "/notifications/contact-review-queue"],
  ["GET", "/notifications/deliveries"],
  ["GET", "/notifications/deliveries/:id"],
  ["GET", "/notifications/inbox/review-queue"],
  ["GET", "/notifications/notifications"],
  ["GET", "/notifications/segments"],
  ["GET", "/notifications/stream/unread"],
  ["PATCH", "/v1/digest-rules/:id"],
  ["PATCH", "/v1/dnd/:id"],
  ["PATCH", "/v1/segments/:id"],
  ["PATCH", "/v1/templates/:templateId/locales/:id"],
  ["PATCH", "/v1/webhooks/:id"],
  ["POST", "/notifications/alert-rules"],
  ["POST", "/notifications/campaigns"],
  ["POST", "/notifications/campaigns/:id/responses"],
  ["POST", "/notifications/contact-review-queue/:id/discard"],
  ["POST", "/notifications/contact-review-queue/:id/resolve"],
  ["POST", "/notifications/inbox/review-queue/:id/discard"],
  ["POST", "/notifications/inbox/review-queue/:id/link"],
  ["POST", "/notifications/inbox/review-queue/:id/resolve"],
  ["POST", "/notifications/publish"],
  ["POST", "/notifications/send"],
  ["POST", "/notifications/stream/mark-read"],
  ["POST", "/v1/digest-rules"],
  ["POST", "/v1/dnd"],
  ["POST", "/v1/scheduling"],
  ["POST", "/v1/segments"],
  ["POST", "/v1/templates/:id/approve"],
  ["POST", "/v1/templates/:id/publish"],
  ["POST", "/v1/templates/:id/reject"],
  ["POST", "/v1/templates/:id/submit"],
  ["POST", "/v1/templates/:templateId/locales"],
  ["POST", "/v1/webhooks"],
];

const url = (p: string) => p.replace(/:[A-Za-z]+/g, "not-a-uuid");
const JSON_CT = { ...headers, "content-type": "application/json" };

describe("notification-service validation probes answer 4xx, never 5xx", () => {
  for (const [method, path] of ROUTES) {
    const u = url(path);
    if (method === "GET" || method === "DELETE") {
      it(`${method} ${path} with bad query + malformed id`, async () => {
        const res = await app.inject({ method: method as "GET", url: `${u}?limit=abc&offset=-5&page=zzz&from=not-a-date`, headers });
        expect(res.statusCode, res.body).toBeLessThan(500);
      });
      continue;
    }
    it(`${method} ${path} with an empty body`, async () => {
      const res = await app.inject({ method: method as "POST", url: u, headers: JSON_CT, payload: "" });
      expect(res.statusCode, res.body).toBeLessThan(500);
    });
    it(`${method} ${path} with malformed JSON -> 400`, async () => {
      const res = await app.inject({ method: method as "POST", url: u, headers: JSON_CT, payload: "{\"a\":" });
      expect(res.statusCode, res.body).toBe(400);
    });
    it(`${method} ${path} with invalid fields`, async () => {
      const res = await app.inject({ method: method as "POST", url: u, headers, payload: { unexpected: 123, id: 42 } });
      expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
      expect(res.statusCode, res.body).toBeLessThan(500);
    });
  }
});
