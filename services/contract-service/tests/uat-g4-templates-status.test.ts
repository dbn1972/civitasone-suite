/**
 * UAT sweep 2026-10-28 — contract-service.
 *  1. registerSchemaErrorHandler ran AFTER the route plugins, so encapsulated route contexts kept
 *     Fastify's default handler and a thrown ZodError became a 500 (templates routes). It must be
 *     registered before the routes (mirrors admin-service); bad input is a 400.
 *  2. Migration 0024 re-syncs contract_contracts_status_check so submit-approval
 *     (draft -> pending_approval) is not rejected by a stale live constraint.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000c7";
const TEMPLATE = "11111111-2222-4000-8000-3333333333c7";
const headers = {
  authorization: `Bearer ${signToken({ sub: "00000000-aaaa-4000-8000-0000000000c7", tid: TENANT, roles: ["super_admin"], sid: "s" }, SECRET, 3600)}`,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const call = (method: "GET" | "PATCH" | "DELETE" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers, ...(payload !== undefined ? { payload } : {}) });

describe("templates routes answer 4xx (never 500) for invalid input", () => {
  it("GET /templates?limit=abc&offset=-5 -> 400", async () => {
    const res = await call("GET", "/v1/contract/templates?limit=abc&offset=-5");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  for (const [method, suffix] of [["GET", ""], ["GET", "/render"]] as const) {
    it(`${method} /templates/not-a-uuid${suffix} -> 400`, async () => {
      const res = await call(method, `/v1/contract/templates/not-a-uuid${suffix}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }

  it("PATCH /templates/:id with {} and with unknown fields -> 400", async () => {
    for (const payload of [{}, { bogus: 1 }]) {
      const res = await call("PATCH", `/v1/contract/templates/${TEMPLATE}`, payload);
      expect(res.statusCode).toBe(400);
    }
  });

  it("DELETE /templates/:id without a body -> 400", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/contract/templates/${TEMPLATE}`, headers });
    expect(res.statusCode).toBe(400);
  });

  it("POST /templates/:id/clauses with {} -> 400", async () => {
    const res = await call("POST", `/v1/contract/templates/${TEMPLATE}/clauses`, {});
    expect(res.statusCode).toBe(400);
  });
});

describe("migration 0024 re-syncs contract_contracts_status_check", () => {
  const sqlText = readFileSync(join(__dirname, "../migrations/0024_contract_status_check_resync.sql"), "utf8");

  it("drops and re-adds the constraint idempotently with pending_approval", () => {
    expect(sqlText).toMatch(/DROP CONSTRAINT IF EXISTS contract_contracts_status_check/);
    expect(sqlText).toMatch(/ADD CONSTRAINT contract_contracts_status_check/);
    expect(sqlText).toContain("'pending_approval'");
    expect(sqlText).toMatch(/NOT VALID/);
  });

  it("the live constraint accepts every status in the domain state machine", async () => {
    const [row] = await sqlClient<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'contract_contracts_status_check'`;
    for (const s of ["draft", "pending_approval", "approved", "active", "closed", "terminated"]) {
      expect(row?.def, s).toContain(`'${s}'`);
    }
  });
});
