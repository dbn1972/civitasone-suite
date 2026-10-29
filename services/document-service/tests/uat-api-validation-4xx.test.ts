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
