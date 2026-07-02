/**
 * estab-service — Extended route coverage tests.
 *
 * Covers previously-untested route handlers: files list, DFA, operators,
 * records/weedout, referencing, handovers, notifications, dashboard.
 * Validates auth enforcement, role gates, and basic response shapes.
 * Uses HS256 test JWT (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UNKNOWN_ID = "00000000-dead-4000-8000-000000000001";

function makeToken(roles: string[] = ["estab_officer"], sub = "user-001") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

function makeAdminToken(sub = "admin-001") {
  return signToken({ sub, tid: TENANT, roles: ["estab_admin"], sid: "sess-002" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ── GET /v1/estab/files ─────────────────────────────────────────────────────

describe("GET /v1/estab/files — list", () => {
  it("returns 200 with paginated shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/files",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.pagination).toBe("object");
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/files" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/files",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/estab/files/:id ─────────────────────────────────────────────────

describe("GET /v1/estab/files/:id — detail", () => {
  it("returns 404 for unknown file ID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${UNKNOWN_ID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/estab/files/${UNKNOWN_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/estab/dfa ───────────────────────────────────────────────────────

describe("GET /v1/estab/dfa — list", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/dfa",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/dfa" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/dfa",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/estab/dfa/:id ───────────────────────────────────────────────────

describe("GET /v1/estab/dfa/:id — detail", () => {
  it("returns 404 for unknown DFA ID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/dfa/${UNKNOWN_ID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ── GET /v1/estab/operators ─────────────────────────────────────────────────

describe("GET /v1/estab/operators — list", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/operators",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/operators" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/operators",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/estab/operators/:id ─────────────────────────────────────────────

describe("GET /v1/estab/operators/:id — detail", () => {
  it("returns 404 for unknown operator ID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/operators/${UNKNOWN_ID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ── GET /v1/estab/weedout ───────────────────────────────────────────────────

describe("GET /v1/estab/weedout — records weed-out list", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    // Records routes require records_officer / estab_admin / super_admin roles
    const token = signToken({ sub: "records-officer-01", tid: TENANT, roles: ["records_officer"], sid: "sess-003" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/weedout",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/weedout" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/weedout",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/estab/files/:fileId/references ──────────────────────────────────

describe("GET /v1/estab/files/:fileId/references — structured referencing", () => {
  it("returns 200 with data for unknown file (empty references)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${UNKNOWN_ID}/references`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/estab/files/${UNKNOWN_ID}/references` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/estab/handovers ─────────────────────────────────────────────────

describe("GET /v1/estab/handovers — list", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/handovers",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/handovers" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/estab/notifications ─────────────────────────────────────────────

describe("GET /v1/estab/notifications — list", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/notifications",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/notifications" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/estab/dashboard ─────────────────────────────────────────────────

describe("GET /v1/estab/dashboard — shape", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/dashboard",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/estab/approval-rules ────────────────────────────────────────────

describe("GET /v1/estab/approval-rules — list", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/approval-rules",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/approval-rules" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/estab/record-requisitions ───────────────────────────────────────

describe("GET /v1/estab/record-requisitions — list", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    // Records routes require records_officer / estab_admin / super_admin roles
    const token = signToken({ sub: "records-officer-01", tid: TENANT, roles: ["records_officer"], sid: "sess-003" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/record-requisitions",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/record-requisitions" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/estab/inward — dak diary ────────────────────────────────────────

describe("GET /v1/estab/inward — list", () => {
  it("returns 200 with paginated shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/inward",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.pagination).toBe("object");
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/inward" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/estab/dispatch ──────────────────────────────────────────────────

describe("GET /v1/estab/dispatch — list", () => {
  it("returns 200 with paginated shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/dispatch",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.pagination).toBe("object");
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/dispatch" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── Unauthenticated batch ───────────────────────────────────────────────────

describe("unauthenticated requests — batch", () => {
  const routes = [
    "/v1/estab/files",
    "/v1/estab/dfa",
    "/v1/estab/operators",
    "/v1/estab/weedout",
    "/v1/estab/handovers",
    "/v1/estab/notifications",
    "/v1/estab/dashboard",
    "/v1/estab/approval-rules",
    "/v1/estab/inward",
    "/v1/estab/dispatch",
    "/v1/estab/record-requisitions",
  ];

  for (const url of routes) {
    it(`GET ${url} without token → 401`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url });
      await app.close();
      expect(res.statusCode).toBe(401);
    });
  }
});
