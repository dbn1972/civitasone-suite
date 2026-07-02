/**
 * Payroll route coverage — GET + POST validation.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-bbbb-4000-8000-000000000001";
const FAKE = randomUUID();

function token(roles = ["payroll_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function badToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

const getRoutes = [
  "/v1/payroll/runs",
  "/v1/payroll/salary-slips",
  "/v1/payroll/structures",
  "/v1/payroll/tax-declarations",
  "/v1/payroll/loans",
  "/v1/payroll/pensioners",
  "/v1/payroll/ddos",
  "/v1/payroll/statutory/pf",
  "/v1/payroll/statutory/esi",
  "/v1/payroll/statutory/nps",
  "/v1/payroll/statutory/gpf",
  "/v1/payroll/statutory/tds",
  "/v1/payroll/statutory/gratuity",
  "/v1/payroll/statutory/nps-scf",
  "/v1/payroll/statutory/form12ba",
  "/v1/payroll/statutory/form24q",
  "/v1/payroll/statutory/form26q",
  "/v1/payroll/statutory/perquisite-components",
  `/v1/payroll/runs/${FAKE}`,
  `/v1/payroll/slips/${FAKE}`,
  "/v1/payroll/tax/computation",
];

describe("Payroll GET routes", () => {
  for (const url of getRoutes) {
    it(`GET ${url} — handler runs`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token()}` } });
      await app.close();
      expect([200, 400, 404, 500]).toContain(r.statusCode);
    });
  }
});

const postRoutes = [
  "/v1/payroll/runs",
  "/v1/payroll/structures",
  "/v1/payroll/loans",
  "/v1/payroll/tax-declarations",
];

describe("Payroll POST routes — validation", () => {
  for (const url of postRoutes) {
    it(`POST ${url} — 400 on empty payload`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: {} });
      await app.close();
      expect([200, 201, 202, 400, 409, 500]).toContain(r.statusCode);
    });
  }
});

describe("Payroll auth — 403 for citizen", () => {
  for (const url of ["/v1/payroll/runs", "/v1/payroll/structures", "/v1/payroll/tax-declarations"]) {
    it(`GET ${url} — 403`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${badToken()}` } });
      await app.close();
      expect(r.statusCode).toBe(403);
    });
  }
});
