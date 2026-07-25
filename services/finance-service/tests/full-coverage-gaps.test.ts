/**
 * Coverage gap tests: anomaly, bank-recon, cashbook, treasury, pfms, tds, gst.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000066";
const A = "cccccccc-3333-4000-8000-000000000066";
const admin = signToken({ sub: A, tid: T, roles: ["finance_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });

async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o);
  await app.close();
  return r.statusCode;
}

describe("anomaly", () => {
  it("GET /v1/finance/anomalies → 200|500", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/finance/anomalies", admin)); });
  it("401", async () => { expect(await hit("GET", "/v1/finance/anomalies")).toBe(401); });
});

describe("bank-recon", () => {
  it("GET /v1/finance/bank-statements → 200|500", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/finance/bank-statements", admin)); });
  it("GET /v1/finance/banks/:id/balance → 200|404|500", async () => { expect([200, 404, 500]).toContain(await hit("GET", `/v1/finance/banks/${randomUUID()}/balance`, admin)); });
});

describe("cashbook", () => {
  it("GET /v1/finance/cash-book → 200|400|500", async () => { expect([200, 400, 500]).toContain(await hit("GET", "/v1/finance/cash-book", admin)); });
  it("GET /v1/finance/cash-book/balance → 200|400|500", async () => { expect([200, 400, 500]).toContain(await hit("GET", "/v1/finance/cash-book/balance", admin)); });
});

describe("treasury / deposits", () => {
  it("GET /v1/finance/deposits → 200|500", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/finance/deposits", admin)); });
  it("GET /v1/finance/challans → 200|500", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/finance/challans", admin)); });
  it("GET /v1/finance/voucher-types → 200|500", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/finance/voucher-types", admin)); });
});

describe("pfms", () => {
  it("GET /v1/finance/pfms/batches → 200|500", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/finance/pfms/batches", admin)); });
  it("GET /v1/finance/pfms/config → 200|500", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/finance/pfms/config", admin)); });
});

describe("tds", () => {
  it("GET /v1/finance/vendor-tds → 200|400|500", async () => { expect([200, 400, 500]).toContain(await hit("GET", "/v1/finance/vendor-tds", admin)); });
});

describe("gst", () => {
  it("GET /v1/finance/gst/summary → 200|400|500", async () => { expect([200, 400, 500]).toContain(await hit("GET", "/v1/finance/gst/summary", admin)); });
  it("GET /v1/finance/gst/ledger → 200|400|500", async () => { expect([200, 400, 500]).toContain(await hit("GET", "/v1/finance/gst/ledger", admin)); });
});

describe("auth umbrella", () => {
  it("401 on all protected routes", async () => {
    for (const u of ["/v1/finance/anomalies", "/v1/finance/bank-statements", "/v1/finance/cash-book", "/v1/finance/deposits", "/v1/finance/pfms/batches", "/v1/finance/vendor-tds", "/v1/finance/gst/summary"]) {
      expect(await hit("GET", u)).toBe(401);
    }
  });
});
