/**
 * CLOS-S4-01 -- folder routes take `:id` as a raw string cast. folders.id is a
 * uuid column, so a malformed id reached Postgres (22P02) and surfaced as a
 * retryable 500 instead of a 400. Each :id route must now reject a non-uuid id
 * with 400 VALIDATION_FAILED before touching the DB.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const tid = randomUUID();
const headers = {
  authorization: `Bearer ${signToken({ sub: randomUUID(), tid, roles: ["document_admin"], sid: "sess-clos-s4-01" }, SECRET)}`,
  "x-tenant-id": tid,
};

const app = await buildApp();
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const routes: Array<{ method: "GET" | "PATCH"; url: string; payload?: unknown }> = [
  { method: "GET", url: "/v1/documents/folders/not-a-uuid" },
  { method: "GET", url: "/v1/documents/folders/not-a-uuid/children" },
  { method: "PATCH", url: "/v1/documents/folders/not-a-uuid/rename", payload: { name: "x" } },
  { method: "PATCH", url: "/v1/documents/folders/not-a-uuid/move", payload: { parentId: null } },
];

describe("CLOS-S4-01: folder :id must be a uuid", () => {
  for (const r of routes) {
    it(`${r.method} ${r.url} -> 400 VALIDATION_FAILED, not 500`, async () => {
      const res = await app.inject({ method: r.method, url: r.url, headers, payload: r.payload as never });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }

  it("a well-formed but unknown uuid still 404s", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/documents/folders/${randomUUID()}`, headers });
    expect(res.statusCode).toBe(404);
  });
});
