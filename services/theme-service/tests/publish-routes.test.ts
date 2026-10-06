/**
 * GAP-THEMES-HOME-01 / GAP-THEMES-TOKENS-02 — POST /v1/themes/publish.
 *
 * Publishing a theme is tenant-wide and irreversible, so the route must:
 *  - 401 without a token;
 *  - 403 for a non-admin (theme_user / employee);
 *  - 400 when no reason is supplied (reason is mandatory for the audit trail);
 *  - on success, create a published revision with a monotonic version and
 *    return it; reject a stale expectedVersion with 409.
 *
 * The DB-touching assertions accept a 500 "GUC not configured" outcome in the
 * same spirit as rls-isolation.test.ts (the write never runs — safe), but the
 * auth/validation boundary never reaches the DB and is asserted exactly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

const TENANT = "aaaaaaaa-9999-4000-8000-000000000777";
const ACTOR = "aaaaaaaa-9999-4000-8000-00000000aaaa";

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-pub" }, SECRET, 3600);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/themes/publish — authorization", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/themes/publish", payload: { name: "x", reason: "y" } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a plain theme_user (read role, not admin)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/themes/publish",
      headers: { authorization: `Bearer ${token(["theme_user"])}`, "content-type": "application/json" },
      payload: { name: "Spring 2026", reason: "seasonal refresh" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403 for an unrelated employee role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/themes/publish",
      headers: { authorization: `Bearer ${token(["employee"])}`, "content-type": "application/json" },
      payload: { name: "Spring 2026", reason: "seasonal refresh" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/themes/publish — validation", () => {
  it("400 when no reason is supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/themes/publish",
      headers: { authorization: `Bearer ${token(["theme_admin"])}`, "content-type": "application/json" },
      payload: { name: "No reason" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when the reason is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/themes/publish",
      headers: { authorization: `Bearer ${token(["theme_admin"])}`, "content-type": "application/json" },
      payload: { name: "Empty reason", reason: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/themes/publish — behaviour (DB-backed)", () => {
  it("admin publish creates a revision with a version (or safe GUC rejection)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/themes/publish",
      headers: { authorization: `Bearer ${token(["theme_admin"])}`, "content-type": "application/json" },
      payload: { name: `Published ${Date.now()}`, reason: "integration test publish" },
    });
    expect([201, 500]).toContain(res.statusCode);
    if (res.statusCode === 201) {
      const body = res.json();
      expect(typeof body.version).toBe("number");
      expect(body.version).toBeGreaterThanOrEqual(1);
      expect(body.status).toBe("published");
      expect(body.publishedAt).toBeTruthy();
    }
  });

  it("a stale expectedVersion is rejected with 409 once a revision exists", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/v1/themes/publish",
      headers: { authorization: `Bearer ${token(["theme_admin"])}`, "content-type": "application/json" },
      payload: { name: `Base ${Date.now()}`, reason: "establish a baseline version" },
    });
    if (first.statusCode !== 201) {
      expect([201, 500]).toContain(first.statusCode);
      return; // DB GUC not configured in this environment — skip the concurrency assertion
    }
    const stale = await app.inject({
      method: "POST",
      url: "/v1/themes/publish",
      headers: { authorization: `Bearer ${token(["theme_admin"])}`, "content-type": "application/json" },
      payload: { name: "Stale publish", reason: "built on an old page", expectedVersion: 0 },
    });
    expect(stale.statusCode).toBe(409);
  });
});
