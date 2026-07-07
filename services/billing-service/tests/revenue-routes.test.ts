import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const SUB_ID = "33333333-cccc-4000-8000-000000000010";

function token(roles: string[] = ["finance_officer"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-rev" }, SECRET, 3600);
}

let app: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("POST /v1/billing/revenue/ledgers", () => {
  it("returns 202 accepted for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/revenue/ledgers",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
      payload: {
        subscriptionId: SUB_ID,
        totalAmountPaise: "1200000",
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-02-01",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.payload);
    expect(body.data.status).toBe("accepted");
    expect(body.data.id).toBeDefined();
  });

  it("returns 400 for invalid totalAmountPaise (not a number)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/revenue/ledgers",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
      payload: {
        subscriptionId: SUB_ID,
        totalAmountPaise: "abc",
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-02-01",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid date format", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/revenue/ledgers",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
      payload: {
        subscriptionId: SUB_ID,
        totalAmountPaise: "1200000",
        servicePeriodStart: "01-01-2025",
        servicePeriodEnd: "2025-02-01",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/revenue/ledgers",
      headers: { "x-tenant-id": TENANT },
      payload: {
        subscriptionId: SUB_ID,
        totalAmountPaise: "1200000",
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-02-01",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/revenue/ledgers",
      headers: { authorization: `Bearer ${token(["employee"])}`, "x-tenant-id": TENANT },
      payload: {
        subscriptionId: SUB_ID,
        totalAmountPaise: "1200000",
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-02-01",
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/billing/revenue/ledgers", () => {
  it("returns 200 with paginated list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/ledgers?page=1&pageSize=10",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toBeDefined();
    expect(body.meta).toBeDefined();
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(10);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/ledgers",
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/ledgers",
      headers: { authorization: `Bearer ${token(["employee"])}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/billing/revenue/ledgers/:id", () => {
  it("returns 404 for non-existent ledger", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/ledgers/00000000-0000-0000-0000-000000000099",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/ledgers/not-a-uuid",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/revenue/ledgers/00000000-0000-0000-0000-000000000099",
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(401);
  });
});
