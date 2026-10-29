/**
 * UAT API sweep 2026-10-29: malformed query / path ids / bodies / JSON must answer 4xx, never 5xx.
 * Root cause: registerSchemaErrorHandler ran AFTER the route plugins were registered, so the encapsulated route
 * contexts kept the Fastify default error handler and a thrown ZodError became a 500; per-module copies of the
 * handler also missed JSON parse errors.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000b1";
const token = signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000b1", tid: T, roles: ["super_admin"], sid: "sess-val" }, SECRET, 3600);
const headers = { authorization: `Bearer ${token}` };
const jsonHeaders = { ...headers, "content-type": "application/json" };
const BAD = "5e7c-not-a-uuid";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

type Probe = [method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string];
function is4xx(code: number): boolean { return code >= 400 && code < 500; }

describe("document-service: malformed JSON body -> 400 MALFORMED_BODY", () => {
  for (const [method, url] of [
  ["POST", "/v1/documents/files"], ["POST", "/v1/documents/folders"], ["POST", "/v1/documents/daks"],
  ["POST", "/v1/documents/shares"], ["POST", "/v1/documents/search"],
  ["PATCH", "/v1/documents/folders/5e7c0000-0000-4000-8000-0000000000c1/rename"],
  ["PATCH", "/v1/documents/folders/5e7c0000-0000-4000-8000-0000000000c1/move"],
  ["POST", "/v1/documents/bulk-scan/batches"], ["POST", "/v1/documents/bulk-scan/profiles"],
] as Probe[]) {
    it(`${method} ${url}`, async () => {
      const res = await app.inject({ method, url, headers: jsonHeaders, payload: "{not json" });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("MALFORMED_BODY");
    });
  }
});

describe("document-service: empty / invalid body -> 400 VALIDATION_FAILED", () => {
  for (const [method, url] of [
  ["POST", "/v1/documents/folders"], ["POST", "/v1/documents/daks"], ["POST", "/v1/documents/shares"],
  ["POST", "/v1/documents/daks/5e7c0000-0000-4000-8000-0000000000c1/forward"],
  ["POST", "/v1/documents/daks/5e7c0000-0000-4000-8000-0000000000c1/notings"],
  ["POST", "/v1/documents/approvals/5e7c0000-0000-4000-8000-0000000000c1/decide"],
  ["PATCH", "/v1/documents/folders/5e7c0000-0000-4000-8000-0000000000c1/rename"],
  ["PATCH", "/v1/documents/folders/5e7c0000-0000-4000-8000-0000000000c1/move"],
] as Probe[]) {
    it(`${method} ${url} with {}`, async () => {
      const res = await app.inject({ method, url, headers: jsonHeaders, payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
    it(`${method} ${url} with wrong-typed fields`, async () => {
      const res = await app.inject({ method, url, headers: jsonHeaders, payload: { id: 1, name: [], code: {}, limit: "x" } });
      expect(is4xx(res.statusCode)).toBe(true);
    });
  }
});

describe("document-service: malformed id / bad query -> 400 VALIDATION_FAILED", () => {
  for (const url of [
  `/v1/documents/files/${BAD}`, `/v1/documents/files/${BAD}/shares`, `/v1/documents/daks/${BAD}`,
  `/v1/documents/daks/${BAD}/notings`, `/v1/documents/folders/${BAD}`,
  "/v1/documents/folders?limit=abc&offset=-5", "/v1/documents/daks?limit=abc", "/v1/documents/inbox?limit=abc&offset=-5",
] as string[]) {
    it(`GET ${url}`, async () => {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

/**
 * UAT API sweep 2026-10-29, W5-A: the 35 bulk-scan rows recorded as "defect-5xx" were never sent. The route
 * extractor kept the literal `${P}` prefix (const P = "/v1/documents/bulk-scan"), so every probe failed with
 * "nonnumeric port: '3049${P}'" (got 0). These pin the sweep's probes, against the resolved paths, to 4xx.
 */
describe("document-service bulk-scan: sweep probes -> 4xx, never 5xx", () => {
  const B = "/v1/documents/bulk-scan";
  const R = "5e7c0000-0000-4000-8000-00000000dead";
  const INVALID = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };
  const reads = ["/search", "/providers", "/links", "/link-lookup", "/review-queue", "/batches", "/settings", "/settings/change-requests", "/profiles"];
  const idReads = ["/files/:a/download", "/files/:a/pages/1/image", "/batches/:a/files/:b/review", "/batches/:a", "/batches/:a/files", "/batches/:a/files/:b", "/profiles/:a"];
  const writes: Probe[] = [
    ["POST", "/links/:a/approve"], ["POST", "/links/:a/reject"], ["POST", "/links/:a/unlink-request"],
    ["POST", "/batches/:a/files/:b/review/edit"], ["POST", "/batches/:a/files/:b/review/approve"], ["POST", "/batches/:a/files/:b/review/reject"],
    ["POST", "/batches"], ["POST", "/batches/:a/cancel"], ["POST", "/batches/:a/files/upload-urls"], ["POST", "/batches/:a/files/complete"],
    ["POST", "/batches/:a/files/:b/upload-url"], ["POST", "/batches/:a/files/:b/retry"], ["POST", "/batches/:a/files/:b/skip"],
    ["PUT", "/settings"], ["POST", "/settings/change-requests/:a/approve"], ["POST", "/settings/change-requests/:a/reject"],
    ["POST", "/profiles"], ["PUT", "/profiles/:a"],
  ];
  const at = (p: string, id: string): string => B + p.replace(":a", id).replace(":b", id);

  for (const p of [...reads, ...idReads]) {
    it(`GET ${p}: no token 401, bad query / malformed id 400, unknown id 404`, async () => {
      expect((await app.inject({ method: "GET", url: at(p, R) })).statusCode).toBe(401);
      if (p.includes(":a")) {
        expect((await app.inject({ method: "GET", url: at(p, R), headers })).statusCode).toBe(404);
        const bad = await app.inject({ method: "GET", url: at(p, BAD), headers });
        expect(bad.statusCode).toBe(400);
        expect(bad.json().code).toBe("VALIDATION_FAILED");
      } else {
        const q = await app.inject({ method: "GET", url: `${B}${p}?limit=abc&offset=-5`, headers });
        expect([200, 400]).toContain(q.statusCode);
      }
    });
  }

  for (const [method, p] of writes) {
    it(`${method} ${p}: no token 401; empty, malformed and invalid bodies 4xx`, async () => {
      expect((await app.inject({ method, url: at(p, R), headers: { "content-type": "application/json" }, payload: {} })).statusCode).toBe(401);
      const empty = await app.inject({ method, url: at(p, R), headers: jsonHeaders, payload: {} });
      expect(is4xx(empty.statusCode)).toBe(true);
      const malformed = await app.inject({ method, url: at(p, R), headers: jsonHeaders, payload: "{not json" });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json().code).toBe("MALFORMED_BODY");
      const invalid = await app.inject({ method, url: at(p, R), headers: jsonHeaders, payload: INVALID });
      expect(is4xx(invalid.statusCode)).toBe(true);
      if (p.includes(":a")) {
        expect((await app.inject({ method, url: at(p, BAD), headers: jsonHeaders, payload: INVALID })).statusCode).toBe(400);
      }
    });
  }

  it("DELETE /profiles/:id: no token 401, unknown id 404, malformed id 400", async () => {
    expect((await app.inject({ method: "DELETE", url: at("/profiles/:a", R) })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: at("/profiles/:a", R), headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: at("/profiles/:a", BAD), headers })).statusCode).toBe(400);
  });
});
