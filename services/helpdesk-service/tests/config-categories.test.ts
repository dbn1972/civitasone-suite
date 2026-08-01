/**
 * CFG-02: Hierarchical Category Master
 * CFG-04: Status Color + Canonical State Mapping
 * CFG-05: Resolution Dispositions Master
 *
 * Tests for /v1/helpdesk/config/categories, statuses, dispositions CRUD + hierarchy.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";
const CAT_ID = "eeeeeeee-5555-4000-8000-000000000001";

function token(roles = ["helpdesk_admin"], tenantId = TENANT) {
  return signToken({ sub: "user-001", tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/helpdesk/config/categories", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/config/categories",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/helpdesk/config/categories" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/config/categories",
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/helpdesk/config/categories", () => {
  it("returns 201 for valid category", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/config/categories",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Network Issues", parentId: null, ordinal: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.name).toBe("Network Issues");
    expect(res.json().data.parentId).toBeNull();
  });

  it("returns 201 for child category with parentId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/config/categories",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "WiFi", parentId: CAT_ID, ordinal: 2 },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.parentId).toBe(CAT_ID);
  });

  it("returns 400 for empty name", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/config/categories",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for helpdesk_user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/config/categories",
      headers: { authorization: `Bearer ${token(["helpdesk_user"])}` },
      payload: { name: "Test" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/helpdesk/config/categories/:id", () => {
  it("returns 200 for valid update", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/config/categories/${CAT_ID}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Updated Name", enabled: false },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.updated).toBe(true);
  });

  it("returns 400 for empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/config/categories/${CAT_ID}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/config/categories/${CAT_ID}`,
      headers: { authorization: `Bearer ${token(["helpdesk_user"])}` },
      payload: { name: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/helpdesk/config/statuses (CFG-04)", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/config/statuses",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

describe("POST /v1/helpdesk/config/statuses (CFG-04)", () => {
  it("returns 201 for valid status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/config/statuses",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "In Progress", color: "#FF5500", canonicalState: "open" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.color).toBe("#FF5500");
    expect(res.json().data.canonicalState).toBe("open");
  });

  it("returns 400 for invalid color format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/config/statuses",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Bad", color: "red", canonicalState: "open" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid canonicalState", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/config/statuses",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "X", color: "#AABBCC", canonicalState: "unknown" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/helpdesk/config/dispositions (CFG-05)", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/config/dispositions",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

describe("POST /v1/helpdesk/config/dispositions (CFG-05)", () => {
  it("returns 201 for valid disposition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/config/dispositions",
      headers: { authorization: `Bearer ${token()}` },
      payload: { label: "Resolved - Fixed", category: "incident" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.label).toBe("Resolved - Fixed");
  });

  it("returns 400 for empty label", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/config/dispositions",
      headers: { authorization: `Bearer ${token()}` },
      payload: { label: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
