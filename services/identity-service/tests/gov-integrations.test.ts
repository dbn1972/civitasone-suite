import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000051";
const A = "cccccccc-3333-4000-8000-000000000051";
const admin = signToken({ sub: A, tid: T, roles: ["identity_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close(); return r.statusCode;
}
describe("Aadhaar eKYC", () => {
  it("POST otp-init → 202|503", async () => { expect([202, 503]).toContain(await hit("POST", "/identity/gov/aadhaar/otp-init", admin, { aadhaarNumber: "123456789012" })); });
  it("POST otp-verify → 200|503", async () => { expect([200, 503]).toContain(await hit("POST", "/identity/gov/aadhaar/otp-verify", admin, { txnId: randomUUID(), otp: "123456" })); });
  it("400 bad aadhaar", async () => { expect(await hit("POST", "/identity/gov/aadhaar/otp-init", admin, { aadhaarNumber: "bad" })).toBe(400); });
  it("401 without auth", async () => { expect(await hit("POST", "/identity/gov/aadhaar/otp-init")).toBe(401); });
});
describe("GSTN", () => {
  it("POST generate-irn → 202|503", async () => { expect([202, 503]).toContain(await hit("POST", "/identity/gov/gstn/generate-irn", admin, { invoiceId: randomUUID(), gstin: "29AABCT1234A1ZH" })); });
  it("POST generate-eway → 202|503", async () => { expect([202, 503]).toContain(await hit("POST", "/identity/gov/gstn/generate-eway", admin, { invoiceId: randomUUID(), transporterId: "T1", vehicleNo: "KA01AB1234" })); });
  it("GET verify/:gstin → 200|503", async () => { expect([200, 503]).toContain(await hit("GET", "/identity/gov/gstn/verify/29AABCT1234A1ZH", admin)); });
});
describe("NIC", () => {
  it("POST validate-pan → 200|503", async () => { expect([200, 503]).toContain(await hit("POST", "/identity/gov/nic/validate-pan", admin, { pan: "ABCDE1234F" })); });
  it("400 bad PAN", async () => { expect(await hit("POST", "/identity/gov/nic/validate-pan", admin, { pan: "bad" })).toBe(400); });
});
describe("UMANG", () => {
  it("POST service-request → 202|503", async () => { expect([202, 503]).toContain(await hit("POST", "/identity/gov/umang/service-request", admin, { serviceId: "rti-status", userId: randomUUID() })); });
});
