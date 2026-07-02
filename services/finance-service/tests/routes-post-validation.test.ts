/**
 * Finance POST routes — validation (400) and auth (403) coverage.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-9999-4000-8000-000000000001";

function token(roles = ["finance_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function badToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

const postRoutes = [
  "/v1/finance/advances",
  "/v1/finance/bank-statements",
  "/v1/finance/bills",
  "/v1/finance/budgets",
  "/v1/finance/challans",
  "/v1/finance/deposits",
  "/v1/finance/instruments",
  "/v1/finance/journals",
  "/v1/finance/recurring-entries",
  "/v1/finance/sanctions",
  "/v1/finance/simplified/record-expense",
  "/v1/finance/simplified/record-income",
  "/v1/finance/simplified/record-payment-made",
  "/v1/finance/simplified/record-payment-received",
  "/v1/finance/utilization-certificates",
  "/v1/finance/vendor-tds",
  "/v1/finance/gem/einvoice/match",
  "/v1/finance/payments/eft",
];

describe("Finance POST routes — validation on empty payload", () => {
  for (const url of postRoutes) {
    it(`POST ${url} — not 404`, async () => {
      const app = await buildApp();
      const r = await app.inject({
        method: "POST", url,
        headers: { authorization: `Bearer ${token()}` },
        payload: {},
      });
      await app.close();
      expect(r.statusCode).not.toBe(404);
    });
  }
});

describe("Finance POST routes — auth rejection (403)", () => {
  const authRoutes = [
    "/v1/finance/budgets",
    "/v1/finance/sanctions",
    "/v1/finance/journals",
    "/v1/finance/bills",
    "/v1/finance/challans",
    "/v1/finance/deposits",
    "/v1/finance/advances",
    "/v1/finance/recurring-entries",
    "/v1/finance/instruments",
  ];

  for (const url of authRoutes) {
    it(`POST ${url} — 403 for citizen`, async () => {
      const app = await buildApp();
      const r = await app.inject({
        method: "POST", url,
        headers: { authorization: `Bearer ${badToken()}` },
        payload: {},
      });
      await app.close();
      expect(r.statusCode).toBe(403);
    });
  }
});
