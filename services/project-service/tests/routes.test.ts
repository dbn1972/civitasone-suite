/**
 * project-service HTTP route tests (inject)
 *
 * Asserts list/detail/dashboard routes return 200 + correct shape.
 * Uses HS256 test JWTs (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-000000000033";

function makeToken(roles: string[] = ["project_manager"]) {
  return signToken({ sub: "user-proj-001", tid: TENANT, roles, sid: "sess-003" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ── 1. GET /v1/projects/projects ─────────────────────────────────────────────

describe("GET /v1/projects/projects — shape", () => {
  it("returns 200 with data array (ProjectSummaryListSchema)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/projects",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ── 2. GET /v1/projects/milestones ───────────────────────────────────────────

describe("GET /v1/projects/milestones — shape", () => {
  it("returns 200 with array (MilestoneSummaryListSchema)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/milestones",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ── 3. GET /v1/projects/schemes ──────────────────────────────────────────────

describe("GET /v1/projects/schemes — shape", () => {
  it("returns 200 with array (SchemeSummaryListSchema)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/schemes",
      headers: { authorization: `Bearer ${makeToken(["project_manager", "finance_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ── 4. GET /v1/projects/fund-releases ────────────────────────────────────────

describe("GET /v1/projects/fund-releases — shape", () => {
  it("returns 200 with array (FundReleaseSummaryListSchema)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/fund-releases",
      headers: { authorization: `Bearer ${makeToken(["project_manager", "finance_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ── 5. GET /v1/projects/projects/:id — 404 for unknown id ────────────────────

describe("GET /v1/projects/projects/:id — not found", () => {
  it("returns 404 for unknown project id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/projects/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ── 6. Unauthenticated request → 401 ─────────────────────────────────────────

describe("unauthenticated requests", () => {
  it("GET /v1/projects/projects without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/projects",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── 7. Wrong role → 403 ──────────────────────────────────────────────────────

describe("authorisation — wrong role", () => {
  it("GET /v1/projects/projects with role 'citizen' → 403", async () => {
    const app = await buildApp();
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/projects",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
