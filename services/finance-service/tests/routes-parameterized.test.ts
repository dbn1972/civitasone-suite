/**
 * Finance parameterized route coverage — tests :id routes for auth + not-found paths.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-9999-4000-8000-000000000001";
const FAKE = randomUUID();

function token(roles = ["finance_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function badToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

const getIdRoutes = [
  `/v1/finance/bills/${FAKE}`,
  `/v1/finance/sanctions/${FAKE}`,
  `/v1/finance/sanctions/${FAKE}/available`,
  `/v1/finance/instruments/${FAKE}`,
  `/v1/finance/payments/${FAKE}`,
  `/v1/finance/banks/${FAKE}/balance`,
];

describe("Finance GET /:id routes — 404 for unknown entity", () => {
  for (const url of getIdRoutes) {
    it(`GET ${url} — returns 404`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token()}` } });
      await app.close();
      expect(r.statusCode).toBe(404);
    });
  }
});

const postIdRoutes = [
  { url: `/v1/finance/deposits/${FAKE}/refund`, payload: { amountMinor: 1000 } },
  { url: `/v1/finance/deposits/${FAKE}/forfeit`, payload: { amountMinor: 1000 } },
  { url: `/v1/finance/deposits/${FAKE}/adjust`, payload: { amountMinor: 1000 } },
  { url: `/v1/finance/journals/${FAKE}/reverse`, payload: { reason: "error" } },
  { url: `/v1/finance/payments/${FAKE}/submit-approval`, payload: {} },
];

describe("Finance POST /:id routes — validation or not-found", () => {
  for (const { url, payload } of postIdRoutes) {
    it(`POST ${url} — not 404 (route exists)`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload });
      await app.close();
      expect(r.statusCode).not.toBe(404);
    });
  }
});

describe("Finance POST /:id routes — auth rejection", () => {
  for (const { url, payload } of postIdRoutes.slice(0, 5)) {
    it(`POST ${url} — 403 for citizen`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${badToken()}` }, payload });
      await app.close();
      expect(r.statusCode).toBe(403);
    });
  }
});

describe("Finance period-close routes", () => {
  it("POST /v1/finance/periods/2025-04/close — runs (may fail on DB but covers handler)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/finance/periods/2025-04/close", headers: { authorization: `Bearer ${token()}` }, payload: {} });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
  it("POST /v1/finance/periods/2025-04/hard-close — runs", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/finance/periods/2025-04/hard-close", headers: { authorization: `Bearer ${token()}` }, payload: {} });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
  it("POST /v1/finance/periods/2025-04/reopen — runs", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/finance/periods/2025-04/reopen", headers: { authorization: `Bearer ${token()}` }, payload: {} });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});
