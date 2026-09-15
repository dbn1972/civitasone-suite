/**
 * COMP-007 -- identity-service `gov-integrations` module smoke test.
 * Registered in app.ts (Aadhaar/GSTN/NIC/UMANG/BBPS/DigiLocker adapters,
 * explicitly documented as "fail-closed: return structured errors when not
 * configured") but had zero test references anywhere in the service.
 *
 * The real, meaningful property to test here isn't a happy-path response --
 * every "success" path is a hardcoded mock regardless (no real UIDAI/GSTN
 * call happens) -- it's the fail-closed guarantee itself: with no API key
 * configured (the default, and the only state this test env can honestly
 * assert), does the route actually refuse to serve a fake "verified" answer?
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000599";

function makeToken(roles: string[] = ["identity_admin"]) {
  return signToken({ sub: "user-comp007-gov", tid: TENANT, roles, sid: "sess-comp007-gov" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

describe("COMP-007: gov-integrations -- fail-closed guarantee", () => {
  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/identity/gov/aadhaar/otp-init", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the gov-integrations ACL", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/identity/gov/aadhaar/otp-init",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { aadhaarNumber: "123456789012" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("Aadhaar eKYC actually fails closed (503 NOT_CONFIGURED) with no UIDAI_API_KEY set, never a fake OTP success", async () => {
    expect(process.env.UIDAI_API_KEY, "test setup: UIDAI_API_KEY must be unset for this to be a real fail-closed check").toBeUndefined();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/identity/gov/aadhaar/otp-init",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { aadhaarNumber: "123456789012" },
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("NOT_CONFIGURED");
  });

  it("GSTN IRN generation also fails closed (503) with no GSTN_API_KEY set", async () => {
    expect(process.env.GSTN_API_KEY).toBeUndefined();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/identity/gov/gstn/generate-irn",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { invoiceId: "11111111-1111-4111-8111-111111111111", gstin: "27AAAAA0000A1Z5" },
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("NOT_CONFIGURED");
  });

  it("returns 400 for a malformed aadhaarNumber instead of accepting garbage input", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/identity/gov/aadhaar/otp-init",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { aadhaarNumber: "not-12-digits" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
