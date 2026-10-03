/**
 * GAP-FINANCE-PERIOD-CLOSE-06 -- GET /v1/finance/periods resolves closed_by (an identity user id) to a
 * display name, so the cockpit never shows a raw id. Best-effort: unreachable identity => null.
 */
import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { fetchUserSummaries, actorName } from "../src/shared/identity-client.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000003b1";
const CLOSER = "00000000-aaaa-4000-8000-0000000003b1";
const token = () => signToken({ sub: CLOSER, tid: TENANT, roles: ["finance_officer"], sid: "sess-closed-by" }, SECRET);

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

beforeAll(async () => {
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_period_close WHERE tenant_id = ${TENANT}::uuid`));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO gl.finance_period_close (tenant_id, period, fiscal_year, status, closed_by, closed_at, created_by)
    VALUES (${TENANT}::uuid, '2026-05', '2026-27', 'soft_close', ${CLOSER}::uuid, now(), ${CLOSER}::uuid)`));
});
afterAll(async () => {
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM gl.finance_period_close WHERE tenant_id = ${TENANT}::uuid`));
  await sqlClient.end();
});

const stubIdentity = (impl: () => Promise<Response>) => {
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("/identity/internal/user-summaries") ? impl() : realFetch(input, init)) as typeof fetch;
  globalThis.fetch = wrapped;
};

describe("identity-client helpers", () => {
  it("actorName returns the name, or null for an unknown or missing id (never the raw id)", () => {
    const names = new Map([["u1", { name: "Asha Verma" }]]);
    expect(actorName(names, "u1")).toBe("Asha Verma");
    expect(actorName(names, "u2")).toBeNull();
    expect(actorName(names, null)).toBeNull();
  });
  it("fetchUserSummaries fails open to an empty map on error or a non-2xx", async () => {
    stubIdentity(() => Promise.reject(new Error("down")));
    expect((await fetchUserSummaries(TENANT)).size).toBe(0);
    stubIdentity(async () => new Response("no", { status: 500 }));
    expect((await fetchUserSummaries(TENANT)).size).toBe(0);
  });
});

describe("GET /v1/finance/periods closedByName", () => {
  it("includes the resolved display name", async () => {
    stubIdentity(async () => new Response(JSON.stringify([{ id: CLOSER, name: "Asha Verma" }]), { status: 200 }));
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/periods", headers: { authorization: `Bearer ${token()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data[0]).toMatchObject({ period: "2026-05", closedBy: CLOSER, closedByName: "Asha Verma" });
    } finally { await app.close(); }
  });
  it("still serves the list, with closedByName null, when the identity service is unreachable", async () => {
    stubIdentity(() => Promise.reject(new Error("down")));
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/periods", headers: { authorization: `Bearer ${token()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data[0]).toMatchObject({ period: "2026-05", closedByName: null });
    } finally { await app.close(); }
  });
});
