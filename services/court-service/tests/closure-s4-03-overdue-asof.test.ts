/**
 * CLOS-S4-03 -- GET /v1/court/cases/overdue and /analytics validated dates by
 * regex only (2026-13-45 reached Postgres -> 500) and defaulted to the UTC
 * date, which is a day behind IST between 00:00 and 05:30 IST.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET as string;
const T = randomUUID();
const headers = {
  authorization: `Bearer ${signToken({ sub: "8888aaaa-8888-4888-8888-888888888888", tid: T, roles: ["court_admin"], sid: "s-s403" }, SECRET, 3600)}`,
};

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });
afterEach(() => { vi.useRealTimers(); });

const get = (url: string) => app.inject({ method: "GET", url, headers });

describe("CLOS-S4-03: overdue/analytics date handling", () => {
  it("overdue: an impossible calendar date falls back to the default instead of 500", async () => {
    const res = await get("/v1/court/cases/overdue?asOf=2026-13-45");
    expect(res.statusCode).toBe(200);
    expect(res.json().asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.json().asOf).not.toBe("2026-13-45");
  });

  it("overdue: a real date is honoured", async () => {
    const res = await get("/v1/court/cases/overdue?asOf=2026-02-28");
    expect(res.statusCode).toBe(200);
    expect(res.json().asOf).toBe("2026-02-28");
  });

  it("overdue: 2026-02-30 (regex-valid, not a real day) is rejected to the default", async () => {
    const res = await get("/v1/court/cases/overdue?asOf=2026-02-30");
    expect(res.statusCode).toBe(200);
    expect(res.json().asOf).not.toBe("2026-02-30");
  });

  it("overdue: default is the IST date (02:00 IST on 23 Oct = 20:30Z on 22 Oct)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-22T20:30:00Z") });
    const res = await get("/v1/court/cases/overdue");
    expect(res.statusCode).toBe(200);
    expect(res.json().asOf).toBe("2026-10-23");
  });

  it("analytics: impossible from/to do not 500 and `to` defaults to the IST date", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-22T20:30:00Z") });
    const res = await get("/v1/court/cases/analytics?from=2026-13-45&to=2026-99-99");
    expect(res.statusCode).toBe(200);
    expect(res.json().period).toEqual({ from: "1970-01-01", to: "2026-10-23" });
  });
});
