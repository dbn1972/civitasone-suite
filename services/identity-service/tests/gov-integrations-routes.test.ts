/**
 * Identity Service — Gov Integrations Route Tests.
 * Tests Aadhaar eKYC, GSTN, and route-level RBAC.
 * Source: modules/gov-integrations/routes.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "dd770001-7777-4000-8000-000000gv001";
const ACTOR = "dd77aaaa-7777-4000-8000-000000gv00a";

function token(roles: string[]) { return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600); }
const adminBearer = () => ({ authorization: `Bearer ${token(["identity_admin"])}` });
const unrelated = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

describe("POST /identity/gov/aadhaar/otp-init — RBAC + validation", () => {
  it("401 without token", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/identity/gov/aadhaar/otp-init", payload: {} }); await app.close(); expect(r.statusCode).toBe(401);
  });
  it("403 for employee", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/identity/gov/aadhaar/otp-init", headers: unrelated(), payload: { aadhaarNumber: "123456789012" } }); await app.close(); expect(r.statusCode).toBe(403);
  });
  it("400 for non-12-digit aadhaar", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/identity/gov/aadhaar/otp-init", headers: adminBearer(), payload: { aadhaarNumber: "12345" } }); await app.close(); expect(r.statusCode).toBe(400);
  });
  it("503 or 202 when configured (fail-closed)", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/identity/gov/aadhaar/otp-init", headers: adminBearer(), payload: { aadhaarNumber: "123456789012" } }); await app.close();
    expect([202, 503]).toContain(r.statusCode); // 503 if UIDAI_API_KEY not set
  });
});

describe("POST /identity/gov/aadhaar/otp-verify — validation", () => {
  it("400 for non-6-digit OTP", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/identity/gov/aadhaar/otp-verify", headers: adminBearer(), payload: { txnId: "10000000-aaaa-4000-8000-000000000001", otp: "12" } }); await app.close(); expect(r.statusCode).toBe(400);
  });
  it("400 for non-UUID txnId", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/identity/gov/aadhaar/otp-verify", headers: adminBearer(), payload: { txnId: "bad", otp: "123456" } }); await app.close(); expect(r.statusCode).toBe(400);
  });
});

describe("POST /identity/gov/gstn/generate-irn — RBAC + validation", () => {
  it("401 without token", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/identity/gov/gstn/generate-irn", payload: {} }); await app.close(); expect(r.statusCode).toBe(401);
  });
  it("403 for employee", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/identity/gov/gstn/generate-irn", headers: unrelated(), payload: { invoiceId: "10000000-aaaa-4000-8000-000000000001", gstin: "29ABCDE1234F1Z5" } }); await app.close(); expect(r.statusCode).toBe(403);
  });
  it("400 for gstin not 15 chars", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/identity/gov/gstn/generate-irn", headers: adminBearer(), payload: { invoiceId: "10000000-aaaa-4000-8000-000000000001", gstin: "29ABC" } }); await app.close(); expect(r.statusCode).toBe(400);
  });
});

describe("GET /identity/gov/gstn/verify/:gstin — validation", () => {
  it("400 for gstin not 15 chars", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "GET", url: "/identity/gov/gstn/verify/SHORT", headers: adminBearer() }); await app.close(); expect(r.statusCode).toBe(400);
  });
});
