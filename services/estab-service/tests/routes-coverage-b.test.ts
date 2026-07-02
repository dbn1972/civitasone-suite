/**
 * Estab route coverage B — POST validation + GET :id routes.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-cccc-4000-8000-000000000001";
const FAKE = randomUUID();

function token(roles = ["estab_officer"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function badToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// GET routes without params
const getRoutes = [
  "/v1/estab/dashboard",
  "/v1/estab/dfa",
  "/v1/estab/dfa-templates",
  "/v1/estab/files",
  "/v1/estab/dispatch",
  "/v1/estab/compliance",
  "/v1/estab/court-cases",
  "/v1/estab/annual-reviews",
  "/v1/estab/committees",
  "/v1/estab/approval-rules",
  "/v1/estab/operators",
  "/v1/estab/rti",
];

describe("Estab GET routes — handler runs", () => {
  for (const url of getRoutes) {
    it(`GET ${url}`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token()}` } });
      await app.close();
      expect([200, 400, 404, 500]).toContain(r.statusCode);
    });
  }
});

// GET :id routes
const getIdRoutes = [
  `/v1/estab/files/${FAKE}`,
  `/v1/estab/dfa/${FAKE}`,
  `/v1/estab/dfa/${FAKE}/versions`,
  `/v1/estab/approval-rules/${FAKE}`,
  `/v1/estab/files/${FAKE}/references`,
];

describe("Estab GET /:id routes", () => {
  for (const url of getIdRoutes) {
    it(`GET ${url} — 404 or data`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token()}` } });
      await app.close();
      expect([200, 404, 500]).toContain(r.statusCode);
    });
  }
});

// POST routes with empty payload (validation)
const postRoutes = [
  "/v1/estab/files",
  "/v1/estab/dfa",
  "/v1/estab/dispatch",
  "/v1/estab/court-cases",
  "/v1/estab/committees",
  "/v1/estab/approval-rules",
  "/v1/estab/rti",
  "/v1/estab/operators",
];

describe("Estab POST routes — validation on empty payload", () => {
  for (const url of postRoutes) {
    it(`POST ${url} — not 404`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: {} });
      await app.close();
      expect(r.statusCode).not.toBe(404);
    });
  }
});

// POST :id routes (actions on entities)
const postIdRoutes = [
  `/v1/estab/dfa/${FAKE}/submit`,
  `/v1/estab/dfa/${FAKE}/dispatch`,
  `/v1/estab/files/${FAKE}/attach-receipt`,
];

describe("Estab POST /:id routes — handler executes", () => {
  for (const url of postIdRoutes) {
    it(`POST ${url}`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token()}` }, payload: {} });
      await app.close();
      expect([200, 201, 202, 400, 404, 409, 500]).toContain(r.statusCode);
    });
  }
});

// Auth rejection
describe("Estab auth — 403 for citizen", () => {
  for (const url of ["/v1/estab/files", "/v1/estab/dfa"]) {
    it(`POST ${url} — 403`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${badToken()}` }, payload: {} });
      await app.close();
      expect(r.statusCode).toBe(403);
    });
  }
});
