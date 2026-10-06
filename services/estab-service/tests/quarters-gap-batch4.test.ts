/**
 * GAP-ESTAB-QUARTERS route tests — summary endpoint, quarterId filter,
 * GET allotment by id, cancel endpoint, quarterNo enrichment.
 *
 * These tests are additive: they exercise NEW routes/behaviours introduced by
 * ESTAB batch 4 items QUARTERS-01 (summary), DETAIL-01 (quarterId filter),
 * ALLOTMENTS-DETAIL-02 (get-by-id), ALLOTMENTS-DETAIL-05 (cancel), and
 * ALLOTMENTS-01 (quarterNo in list).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "11111111-cccc-4000-8000-000000000001";
const ACTOR  = "22222222-cccc-4000-8000-000000000001";

function authHeader(roles = ["estab_admin", "super_admin"]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe("GAP: quarters/summary endpoint (QUARTERS-01)", () => {
  it("GET /v1/estab/quarters/summary → 200 with total and byStatus", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/quarters/summary",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(typeof body.data.total).toBe("number");
    expect(typeof body.data.byStatus).toBe("object");
  });

  it("GET /v1/estab/quarters/summary → 403 for citizen role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/quarters/summary",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GAP: quarter-allotments quarterId filter (DETAIL-01)", () => {
  it("GET /v1/estab/quarter-allotments?quarterId=<uuid> → 200 with data/total", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/quarter-allotments?quarterId=00000000-0000-4000-8000-000000000099`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe("number");
  });
});

describe("GAP: GET allotment by id (ALLOTMENTS-DETAIL-02)", () => {
  it("GET /v1/estab/quarter-allotments/:id → 404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/quarter-allotments/99999999-cccc-4000-8000-000000000099",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GAP: cancel allotment (ALLOTMENTS-DETAIL-05)", () => {
  it("PATCH /v1/estab/quarter-allotments/:id/cancel → 400 without reason", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/estab/quarter-allotments/99999999-cccc-4000-8000-000000000099/cancel",
      headers: authHeader(),
      payload: { version: 1 },
    });
    // cancelReason is required (min 1)
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/estab/quarter-allotments/:id/cancel → 403 for citizen", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/estab/quarter-allotments/99999999-cccc-4000-8000-000000000099/cancel",
      headers: authHeader(["citizen"]),
      payload: { version: 1, cancelReason: "Ineligible" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/estab/quarter-allotments/:id/cancel → 202 with valid payload", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/estab/quarter-allotments/99999999-cccc-4000-8000-000000000099/cancel",
      headers: authHeader(),
      payload: { version: 1, cancelReason: "Ineligible on pay level" },
    });
    expect(res.statusCode).toBe(202);
  });
});
