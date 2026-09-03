/**
 * Sponsor bank config route tests (inject)
 *
 * Tests the GET/PUT /v1/payroll/sponsor-bank-config endpoints.
 * Uses HS256 test JWTs (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { sponsorBankConfig } from "../src/modules/sponsor-config/schema.js";
import { queue } from "../src/shared/infra.js";
import { registerSponsorConfigConsumers } from "../src/modules/sponsor-config/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-000000000033";

function makeToken(roles: string[] = ["payroll_admin"]) {
  return signToken({ sub: "00000000-0000-4000-8000-000000000099", tid: TENANT, roles, sid: "sess-sponsor-001" }, SECRET);
}

// PUT was converted to F3 async-write (202); the consumer that applies the
// upsert only runs in src/worker.ts in production, so register it here
// against the real queue singleton the app uses (same pattern as
// admin-service's tests/admin.test.ts).
registerSponsorConfigConsumers(queue);

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/payroll/sponsor-bank-config", () => {
  beforeAll(async () => {
    // Ensure no stale data from prior test runs
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(sponsorBankConfig).where(eq(sponsorBankConfig.tenantId, TENANT));
    }));
  });

  it("returns 404 when no config exists", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/sponsor-bank-config",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const token = makeToken(["employee"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PUT /v1/payroll/sponsor-bank-config", () => {
  const validBody = {
    sponsorCode: "HDFC",
    sponsorIfsc: "HDFC0001234",
    sponsorAccount: "123456789012",
    utilityCode: "NACH00000000012",
    userNumber: "USR12345",
    settlementOffsetDays: 1,
    nachEnabled: true,
    apbsEnabled: false,
    maxRecordsPerFile: 100000,
    maxAmountPerFileMinor: "1000000000",
  };

  it("upserts config and GET returns it", async () => {
    const app = await buildApp();
    const token = makeToken();

    const putRes = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: validBody,
    });
    // F3 CQRS: publishes sponsorConfigUpsert and returns 202 — drain the
    // queue so the consumer's real DB write lands before we GET it back.
    expect(putRes.statusCode).toBe(202);
    expect(putRes.json().status).toBe("accepted");
    await queue.drain();

    const getRes = await app.inject({
      method: "GET",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    const config = getRes.json();
    expect(config.sponsorCode).toBe("HDFC");
    expect(config.sponsorIfsc).toBe("HDFC0001234");
    expect(config.tenantId).toBe(TENANT);

    await app.close();
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid IFSC format", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { ...validBody, sponsorIfsc: "INVALID" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for sponsor_code not exactly 4 chars", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { ...validBody, sponsorCode: "HD" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for utility_code exceeding 18 chars", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { ...validBody, utilityCode: "A".repeat(19) },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for user_number exceeding 20 chars", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { ...validBody, userNumber: "U".repeat(21) },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("super_admin can also upsert", async () => {
    const app = await buildApp();
    const token = makeToken(["super_admin"]);
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});
