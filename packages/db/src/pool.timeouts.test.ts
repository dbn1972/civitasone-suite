import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// V4-F-04: shared pools must bound query / idle-in-transaction time and recycle connections.
const captured: Array<Record<string, unknown>> = [];
vi.mock("postgres", () => ({
  default: (_url: string, opts: Record<string, unknown>) => { captured.push(opts); return {}; },
}));

import { createSqlClient } from "./pool.js";

const ENV_KEYS = ["DB_VIA_PGBOUNCER", "DB_STATEMENT_TIMEOUT_MS", "DB_IDLE_IN_TX_TIMEOUT_MS", "DB_MAX_LIFETIME_S"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => { captured.length = 0; for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const last = () => captured[captured.length - 1] as { connection?: Record<string, unknown>; max_lifetime?: number };

describe("createSqlClient server-side limits (V4-F-04)", () => {
  it("sets default statement_timeout, idle_in_transaction_session_timeout and max_lifetime", () => {
    createSqlClient("postgres://u@db:5432/x");
    expect(last().connection?.statement_timeout).toBeGreaterThan(0);
    expect(last().connection?.idle_in_transaction_session_timeout).toBeGreaterThan(0);
    expect(last().max_lifetime).toBeGreaterThan(0);
  });

  it("is env-overridable and 0 disables a limit", () => {
    process.env.DB_STATEMENT_TIMEOUT_MS = "1234";
    process.env.DB_IDLE_IN_TX_TIMEOUT_MS = "0";
    process.env.DB_MAX_LIFETIME_S = "99";
    createSqlClient("postgres://u@db:5432/x");
    expect(last().connection?.statement_timeout).toBe(1234);
    expect(last().connection?.idle_in_transaction_session_timeout).toBeUndefined();
    expect(last().max_lifetime).toBe(99);
  });

  it("sends no startup parameters through pgbouncer (it rejects unknown ones)", () => {
    createSqlClient("postgres://u@db:6432/x");
    expect(last().connection?.statement_timeout).toBeUndefined();
    expect(last().max_lifetime).toBeGreaterThan(0);
  });
});
