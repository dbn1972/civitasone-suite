/**
 * POST /v1/payroll/tax/form16/verify: staff-only + per-user rate limit.
 *
 * Before this change the route called resolveContext() only ("any authenticated user"): a
 * citizen-portal token could push attacker-controlled bytes into the PDF/PKCS#7 verifier, with
 * nothing but the shared 300/min bucket in front of it.
 *   - citizen / external principal -> 403 FORBIDDEN (before any parsing)
 *   - staff (employee, payroll_*, ...) -> 200
 *   - per-user bucket: FORM16_VERIFY_MAX (default 10) per minute per actor, 429 beyond; a second
 *     user is unaffected, and the limit applies to staff only (a 403 does not burn the bucket's
 *     owner's quota for another actor).
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000077";
const tok = (sub: string, roles: string[]) => `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s-f16" }, SECRET)}`;

vi.mock("@civitasone/render", () => ({
  verifyPdfSignature: vi.fn(() => ({ valid: false, issues: ["no_signature"] })),
  renderPdf: vi.fn(),
  signPdfWithDsc: vi.fn(),
  validateDscCertificate: vi.fn(),
  DscValidationError: class extends Error { constructor(m: string, public readonly code: string) { super(m); } },
}));
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("mock")),
  deleteObject: vi.fn(async () => undefined),
  presignedGetUrl: vi.fn(async () => "https://s3.example.com/presigned"),
}));

const pdfBase64 = Buffer.from("%PDF-1.7 unsigned").toString("base64");
const verify = (app: Awaited<ReturnType<typeof buildApp>>, authorization: string) =>
  app.inject({ method: "POST", url: "/v1/payroll/tax/form16/verify", headers: { authorization }, payload: { pdfBase64 } });

describe("form16 verify: staff-only", () => {
  it("citizen -> 403 FORBIDDEN", async () => {
    const app = await buildApp();
    const r = await verify(app, tok(randomUUID(), ["citizen"]));
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
    await app.close();
  });

  it("service_account and unknown roles -> 403", async () => {
    const app = await buildApp();
    for (const role of ["service_account", "guest"]) {
      expect((await verify(app, tok(randomUUID(), [role]))).statusCode).toBe(403);
    }
    await app.close();
  });

  it.each([["employee"], ["payroll_officer"], ["payroll_admin"], ["hr_admin"]])("%s -> 200", async (role) => {
    const app = await buildApp();
    const r = await verify(app, tok(randomUUID(), [role]));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().data.valid).toBe(false);
    await app.close();
  });

  it("no token -> 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/payroll/tax/form16/verify", payload: { pdfBase64 } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("form16 verify: per-user rate limit", () => {
  it("the 11th call in a minute by ONE user is 429; a different user is unaffected", async () => {
    const app = await buildApp();
    const heavy = tok(randomUUID(), ["employee"]);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await verify(app, heavy)).statusCode);
    expect(codes.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(codes[10]).toBe(429);

    const other = await verify(app, tok(randomUUID(), ["employee"]));
    expect(other.statusCode).toBe(200);
    await app.close();
  });

  it("a rejected (403) citizen request is not a way around the per-user bucket of staff", async () => {
    const app = await buildApp();
    const staffTok = tok(randomUUID(), ["employee"]);
    for (let i = 0; i < 12; i++) await verify(app, tok(randomUUID(), ["citizen"]));
    expect((await verify(app, staffTok)).statusCode).toBe(200);
    await app.close();
  });
});
