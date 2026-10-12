/**
 * Request validation at the HTTP boundary (zod): a bad body or query is a 400
 * VALIDATION_FAILED and never enqueues a command or writes a row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { authHeader, stubCompositionFetch } from "./_helpers.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const headers = () => authHeader(TENANT, ACTOR, ["smarttransfer_admin"]);

let app: FastifyInstance;
let restoreFetch: () => void;

beforeAll(async () => {
  restoreFetch = stubCompositionFetch(() => ({ configured: true, data: [{ name: "smarttransfer" }] }));
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  restoreFetch();
  await app.close();
  await sqlClient.end();
});

const calendar = {
  opensAt: "2026-01-01T00:00:00.000Z",
  freezesAt: "2026-02-01T00:00:00.000Z",
  closesAt: "2026-03-01T00:00:00.000Z",
};

function valid(over: Record<string, unknown> = {}) {
  return { name: "Cycle", movementTypeId: randomUUID(), calendar, ...over };
}

async function post(payload: unknown) {
  return app.inject({ method: "POST", url: "/v1/smarttransfer/cycles", headers: headers(), payload: payload as never });
}

describe("POST /v1/smarttransfer/cycles body validation", () => {
  it("accepts a valid body (202) including an equal-instant window", async () => {
    expect((await post(valid())).statusCode).toBe(202);
    const same = { opensAt: calendar.opensAt, freezesAt: calendar.opensAt, closesAt: calendar.opensAt };
    expect((await post(valid({ calendar: same }))).statusCode).toBe(202);
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    ["missing movementTypeId", { movementTypeId: undefined }],
    ["non-UUID movementTypeId", { movementTypeId: "not-a-uuid" }],
    ["empty name", { name: "" }],
    ["missing calendar", { calendar: undefined }],
    ["non-ISO instant", { calendar: { ...calendar, opensAt: "tomorrow" } }],
    ["missing instant", { calendar: { opensAt: calendar.opensAt, closesAt: calendar.closesAt } }],
    ["closes before it opens", { calendar: { opensAt: calendar.closesAt, freezesAt: calendar.freezesAt, closesAt: calendar.opensAt } }],
    ["freezes after it closes", { calendar: { opensAt: calendar.opensAt, freezesAt: "2026-04-01T00:00:00.000Z", closesAt: calendar.closesAt } }],
    ["freezes before it opens", { calendar: { opensAt: calendar.freezesAt, freezesAt: calendar.opensAt, closesAt: calendar.closesAt } }],
  ];
  for (const [label, over] of cases) {
    it(`rejects ${label} with 400 VALIDATION_FAILED`, async () => {
      const res = await post(valid(over));
      expect(res.statusCode).toBe(400);
      expect((res.json() as { code: string }).code).toBe("VALIDATION_FAILED");
    });
  }
});

describe("GET validation", () => {
  const bad = [
    "/v1/smarttransfer/cycles?page=0",
    "/v1/smarttransfer/cycles?page=abc",
    "/v1/smarttransfer/cycles?pageSize=101",
    "/v1/smarttransfer/cycles?pageSize=-1",
    "/v1/smarttransfer/cycles/not-a-uuid",
    "/v1/smarttransfer/commands/not-a-uuid",
  ];
  for (const url of bad) {
    it(`rejects ${url} with 400`, async () => {
      const res = await app.inject({ method: "GET", url, headers: headers() });
      expect(res.statusCode).toBe(400);
    });
  }
});
