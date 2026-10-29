/**
 * UAT API sweep 2026-10-28: registerSchemaErrorHandler ran AFTER the stock route plugins, so a
 * ZodError thrown in a route handler became a 500. Invalid input must be a 400 VALIDATION_FAILED.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const headers = {
  authorization: `Bearer ${signToken({ sub: "00000000-aaaa-4000-8000-0000000000f7", tid: "aaaaaaaa-1111-4000-8000-0000000000f7", roles: ["stock_admin"], sid: "s" }, SECRET, 3600)}`,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("stock routes: invalid input -> 400 VALIDATION_FAILED (never 500)", () => {
  it("POST /v1/stock/entries with {} ", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/stock/entries", headers, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /v1/stock/entries transfer without warehouses", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/stock/entries", headers,
      payload: { entryType: "transfer", postingDate: "2026-10-28", items: [{ itemId: "a07c61eb-b87b-4a94-bab6-ef30b7824fd0", qty: 1, rateMinor: 1 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/stock/ledger?limit=abc", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/stock/ledger?limit=abc", headers });
    expect(res.statusCode).toBe(400);
  });
});
