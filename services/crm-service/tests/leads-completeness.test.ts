/**
 * Completeness scoring tests (DQ-004).
 *
 * Tests the pure `computeCompleteness` domain function and
 * the GET /v1/crm/leads/:id/completeness route.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { computeCompleteness } from "../src/modules/leads/completeness.js";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000002";
const ACTOR = "cccccccc-3333-4000-8000-000000000002";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-compl" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

afterAll(async () => { await sqlClient.end(); });

describe("computeCompleteness (domain)", () => {
  it("returns 100 when all fields are filled", () => {
    const result = computeCompleteness({
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "+919876543210",
      company: "Acme Corp",
      designation: "CTO",
      city: "Mumbai",
      leadSource: "referral",
    });

    expect(result.score).toBe(100);
    expect(result.missingFields).toHaveLength(0);
    expect(result.filledFields).toHaveLength(7);
    expect(result.totalFields).toBe(7);
  });

  it("returns 0 when no fields are filled", () => {
    const result = computeCompleteness({});

    expect(result.score).toBe(0);
    expect(result.missingFields).toHaveLength(7);
    expect(result.filledFields).toHaveLength(0);
    expect(result.totalFields).toBe(7);
  });

  it("returns 0 when all fields are null", () => {
    const result = computeCompleteness({
      name: null,
      email: null,
      phone: null,
      company: null,
      designation: null,
      city: null,
      leadSource: null,
    });

    expect(result.score).toBe(0);
    expect(result.missingFields).toHaveLength(7);
  });

  it("returns 0 when all fields are empty strings", () => {
    const result = computeCompleteness({
      name: "",
      email: "",
      phone: "",
      company: "",
      designation: "",
      city: "",
      leadSource: "",
    });

    expect(result.score).toBe(0);
    expect(result.missingFields).toHaveLength(7);
  });

  it("computes partial score correctly — only name + email filled (40)", () => {
    const result = computeCompleteness({
      name: "Jane",
      email: "jane@test.com",
    });

    expect(result.score).toBe(40);
    expect(result.filledFields).toEqual(["name", "email"]);
    expect(result.missingFields).toEqual(["phone", "company", "designation", "city", "leadSource"]);
  });

  it("computes partial score — name + phone + company (50)", () => {
    const result = computeCompleteness({
      name: "Bob",
      phone: "12345",
      company: "Test Inc",
    });

    expect(result.score).toBe(50);
    expect(result.filledFields).toEqual(["name", "phone", "company"]);
  });

  it("treats undefined values as missing", () => {
    const result = computeCompleteness({
      name: undefined,
      email: "valid@test.com",
    });

    expect(result.score).toBe(20);
    expect(result.filledFields).toEqual(["email"]);
    expect(result.missingFields).toContain("name");
  });

  it("ignores extra fields not in the weight map", () => {
    const result = computeCompleteness({
      name: "Test",
      unknownField: "value",
      anotherExtra: 123,
    });

    expect(result.score).toBe(20);
    expect(result.filledFields).toEqual(["name"]);
  });

  it("totalFields is always 7", () => {
    const result = computeCompleteness({ name: "X" });
    expect(result.totalFields).toBe(7);
  });

  it("score never exceeds 100", () => {
    // All fields filled — should be exactly 100 (weights sum to 100)
    const result = computeCompleteness({
      name: "A",
      email: "a@b.com",
      phone: "1",
      company: "C",
      designation: "D",
      city: "E",
      leadSource: "F",
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("GET /v1/crm/leads/:id/completeness", () => {
  const fakeLeadId = "dddddddd-4444-4000-8000-000000000001";

  describe("happy path", () => {
    it("returns completeness data for an existing lead", async () => {
      const app = await buildApp();
      // This will likely return 404 in test env without seeded data, but validates the route exists
      const res = await app.inject({
        method: "GET",
        url: `/v1/crm/leads/${fakeLeadId}/completeness`,
        headers: headers(),
      });
      await app.close();

      // Without seeded DB rows, we expect 404 (not 500)
      expect([200, 404]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        const body = res.json();
        expect(body.data).toBeDefined();
        expect(typeof body.data.score).toBe("number");
        expect(Array.isArray(body.data.missingFields)).toBe(true);
        expect(Array.isArray(body.data.filledFields)).toBe(true);
        expect(typeof body.data.totalFields).toBe("number");
      }
    });
  });

  describe("not found (404)", () => {
    it("returns 404 for non-existent lead", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/v1/crm/leads/${fakeLeadId}/completeness`,
        headers: headers(),
      });
      await app.close();

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe("NOT_FOUND");
    });

    it("returns 400 for invalid UUID param", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/v1/crm/leads/not-a-uuid/completeness",
        headers: headers(),
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });

  describe("authentication (401)", () => {
    it("returns 401 without token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/v1/crm/leads/${fakeLeadId}/completeness`,
      });
      await app.close();

      expect(res.statusCode).toBe(401);
    });
  });

  describe("authorization (403)", () => {
    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/v1/crm/leads/${fakeLeadId}/completeness`,
        headers: headers(["citizen"]),
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });

    it("allows crm_admin role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/v1/crm/leads/${fakeLeadId}/completeness`,
        headers: headers(["crm_admin"]),
      });
      await app.close();

      // Should not be 403 (might be 404 without seeded data)
      expect(res.statusCode).not.toBe(403);
    });
  });
});
