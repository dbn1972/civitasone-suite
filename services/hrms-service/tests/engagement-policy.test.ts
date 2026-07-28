/**
 * Engagement-policy routes — integration against real Postgres.
 * The canonical 5-type catalogue is seeded by migration 0065.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000e9";
const auth = (roles: string[] = ["hr_admin"]) => ({ authorization: `Bearer ${signToken({ sub: "u-eng", tid: TENANT, roles, sid: "s" }, SECRET)}` });

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/hrms/engagement-types", () => {
  it("returns the 5 canonical DIC engagement types with correct policy", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/engagement-types", headers: auth() });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    const cats = rows.map((r) => r.category);
    ["pay_scale", "contractual", "consultant", "third_party", "apprentice"].forEach((c) => expect(cats).toContain(c));

    const cn = rows.find((r) => r.category === "consultant")!;
    expect(cn.eligibleForPayroll).toBe(false);   // consultants are NOT in payroll
    expect(cn.paymentRoute).toBe("invoice");
    expect(cn.taxSection).toBe("194J");
    expect(cn.statutoryPf).toBe(false);

    const ap = rows.find((r) => r.category === "apprentice")!;
    expect(ap.payMode).toBe("stipend");
    expect(ap.statutoryPf).toBe(false);
    expect(ap.eligibleForGratuity).toBe(false);

    const tp = rows.find((r) => r.category === "third_party")!;
    expect(tp.paymentRoute).toBe("agency");
    expect(tp.taxSection).toBe("194C");

    const ps = rows.find((r) => r.category === "pay_scale")!;
    expect(ps.statutoryNps).toBe(true);          // pay-scale on NPS
    expect(ps.eligibleForGratuity).toBe(true);
    await app.close();
  });

  it("requires an authenticated HR/staff role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/engagement-types" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/hrms/employee-types/:code/policy", () => {
  it("resolves the canonical policy for a known category code", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/employee-types/consultant/policy", headers: auth() });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.source).toBe("canonical");
    expect(b.policy.eligibleForPayroll).toBe(false);
    expect(b.policy.taxSection).toBe("194J");
    await app.close();
  });

  it("returns 404 for an unknown type", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/employee-types/does-not-exist/policy", headers: auth() });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
