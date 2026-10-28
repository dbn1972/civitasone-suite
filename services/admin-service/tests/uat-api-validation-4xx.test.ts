/**
 * UAT API sweep 2026-10-28: malformed query / path ids / bodies must answer 400 (or 404), never 500.
 * Root cause: registerSchemaErrorHandler ran AFTER the route plugins were registered, so the
 * encapsulated route contexts kept Fastify default error handler and a thrown ZodError became a 500.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000b1";
const headers = { authorization: `Bearer ${signToken({ sub: "5e7cacc0-0000-4000-8000-0000000000b1", tid: T, roles: ["super_admin"], sid: "sess-val" }, SECRET, 3600)}` };

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const LIST_ROUTES = [
  "/v1/admin/roles",
  "/v1/admin/permissions",
  "/v1/admin/audit-logs",
  "/v1/admin/mfa/users",
  "/v1/admin/integration-ops/dead-letters",
  "/v1/admin/feature-flags",
];

describe("bad pagination query -> 400 VALIDATION_FAILED", () => {
  for (const url of LIST_ROUTES) {
    it(`GET ${url}?limit=abc&offset=-5`, async () => {
      const f = vi.fn();
      vi.stubGlobal("fetch", f);
      const res = await app.inject({ method: "GET", url: `${url}?limit=abc&offset=-5`, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
      expect(f).not.toHaveBeenCalled();
    });
  }
});

describe("malformed id path param -> 400", () => {
  for (const url of [
    "/v1/admin/roles/not-a-uuid",
    "/v1/admin/user-roles/not-a-uuid",
    "/v1/admin/integration-ops/dead-letters/not-a-uuid",
  ]) {
    it(`GET ${url}`, async () => {
      const f = vi.fn();
      vi.stubGlobal("fetch", f);
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
      expect(f).not.toHaveBeenCalled();
    });
  }
});

describe("POST /v1/admin/integration-ops/dead-letters with an invalid body", () => {
  it("rejects {} with 400 VALIDATION_FAILED naming the missing field", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/integration-ops/dead-letters", headers, payload: {} });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.fieldErrors.map((e: { field: string }) => e.field)).toContain("topic");
  });
});

describe("PATCH /v1/admin/roles/:id is intentionally unimplemented", () => {
  // identity-service RBAC has no role-metadata-update command and the web app only calls
  // PATCH /v1/admin/roles/:id/permissions. The route answers a deliberate, documented 501.
  it("answers 501 NOT_IMPLEMENTED for a valid id and 400 for a malformed one", async () => {
    const ok = await app.inject({ method: "PATCH", url: "/v1/admin/roles/5e7c0000-0000-4000-8000-0000000000c1", headers, payload: {} });
    expect(ok.statusCode).toBe(501);
    expect(ok.json().code).toBe("NOT_IMPLEMENTED");
    const bad = await app.inject({ method: "PATCH", url: "/v1/admin/roles/not-a-uuid", headers, payload: {} });
    expect(bad.statusCode).toBe(400);
  });
});
