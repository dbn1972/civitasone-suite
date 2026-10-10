/**
 * GPF money validation: minor units (paise) are a strict base-10 integer STRING (/^\d+$/),
 * converted with BigInt - never z.coerce.number(). Real DB so the full route stack runs.
 *
 * Before: amountMinor: z.coerce.number().int().positive() accepted JSON numbers, numeric
 * strings with exponents ("1e3"), padded strings (" 5 ") and silently rounded anything above
 * 2^53 on a statutory PF ledger.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const EMP = randomUUID();
const hdr = { authorization: `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles: ["hr_admin"], sid: "sess-gpf-money" }, SECRET, 3600)}` };

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const post = (path: string, payload: unknown) =>
  app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/${path}`, headers: hdr, payload: payload as object });

const POSTINGS = ["subscription", "advance", "withdrawal", "refund"] as const;

// Every one of these must be refused with 400 VALIDATION_FAILED, before any account lookup or publish.
const BAD_AMOUNTS: Array<[string, unknown]> = [
  ["float number", 10.5],
  ["float string", "10.5"],
  ["negative number", -100],
  ["negative string", "-100"],
  ["integer JSON number (not a string)", 1000],
  ["exponent string", "1e3"],
  ["padded string", " 5 "],
  ["empty string", ""],
  ["zero (must be > 0)", "0"],
  ["leading plus", "+5"],
  ["hex", "0x10"],
  ["non-numeric", "abc"],
  ["19 digits (beyond 64-bit-safe width)", "9999999999999999999"],
  ["null", null],
];

describe("GPF posting routes reject anything but a positive integer string of minor units", () => {
  for (const kind of POSTINGS) {
    for (const [label, amountMinor] of BAD_AMOUNTS) {
      it(`${kind}: ${label} -> 400`, async () => {
        const r = await post(kind, { amountMinor });
        expect(r.statusCode, r.body).toBe(400);
        expect(r.json().code).toBe("VALIDATION_FAILED");
        expect(r.json().fieldErrors.map((f: { field: string }) => f.field)).toContain("amountMinor");
      });
    }
    it(`${kind}: missing amountMinor -> 400`, async () => {
      const r = await post(kind, {});
      expect(r.statusCode).toBe(400);
    });
    it(`${kind}: a valid integer string passes validation (then 404 NO_GPF_ACCOUNT, no account seeded)`, async () => {
      const r = await post(kind, { amountMinor: "125000" });
      expect(r.statusCode, r.body).toBe(404);
      expect(r.json().code).toBe("NO_GPF_ACCOUNT");
    });
  }
});

describe("open-account balances use the same strict minor-units string", () => {
  const open = (extra: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf`, headers: hdr, payload: { gpfNumber: "GPF-1", ...extra } });

  for (const field of ["openingBalanceMinor", "monthlySubscriptionMinor"]) {
    for (const [label, v] of [["float number", 10.5], ["float string", "10.5"], ["negative", "-1"], ["JSON number", 5], ["exponent", "1e3"]] as Array<[string, unknown]>) {
      it(`${field}: ${label} -> 400`, async () => {
        const r = await open({ [field]: v });
        expect(r.statusCode, r.body).toBe(400);
        expect(r.json().code).toBe("VALIDATION_FAILED");
      });
    }
  }

  it("zero and omitted balances are allowed (default \"0\"); the request reaches the employee lookup (404), not a 400", async () => {
    const r = await open({ openingBalanceMinor: "0" });
    expect(r.statusCode, r.body).toBe(404);
    const r2 = await open({});
    expect(r2.statusCode, r2.body).toBe(404);
  });
});
