/**
 * GAP-COURT-CASES-01: the case-registry list endpoint returns the TRUE total
 * for the tenant/status filter (not just the capped page length), so the web
 * registry can paginate with an honest "Showing X–Y of N". e2e against the
 * REAL DB as the non-superuser court_svc role, tenant-scoped (RLS). Opt-in via
 * COURT_E2E=1 (point DATABASE_URL at a disposable Postgres — localhost:5672).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET as string; // injected by vitest.config.ts

const T = randomUUID();
const OTHER_T = randomUUID();
const ACTOR = "8888aaaa-8888-4888-8888-888888888888";
const COURT_ID = randomUUID();

function token(tid: string): string {
  return signToken({ sub: ACTOR, tid, roles: ["court_admin"], sid: "sess-list" }, SECRET, 3600);
}

let app: FastifyInstance;

// FLAKY-SKIP: Requires COURT_E2E=1 plus a live court-service stack (real Postgres + HTTP); unset in standard CI so this e2e suite never executes there. (expires: 2026-12-13)
describe.skipIf(!RUN)("court-service case list — total + pagination (e2e, RLS)", () => {
  beforeAll(async () => {
    app = await buildApp();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`insert into court.courts (id, tenant_id, name, court_type) values (${COURT_ID}, ${T}, ${"List Court"}, ${"revenue"})`;
      for (let i = 0; i < 30; i++) {
        await sql`
          insert into court.cases (id, tenant_id, cnr_number, case_type, filing_date, title, status, stage, court_id)
          values (${randomUUID()}, ${T}, ${`LS${i}${Date.now()}`}, ${"civil"}, ${"2026-01-10"}, ${`Case ${i}`},
                  ${i < 20 ? "pending" : "disposed"}, ${i < 20 ? "pending" : "disposed"}, ${COURT_ID})`;
      }
    });
  });

  afterAll(async () => {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`delete from court.cases where tenant_id = ${T}`;
      await sql`delete from court.courts where tenant_id = ${T}`;
    });
    await app.close();
    await sqlClient.end();
  });

  it("returns a true total of 30 while a page holds at most `limit` rows", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/cases?limit=25&offset=0",
      headers: { authorization: `Bearer ${token(T)}` },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.total).toBe(30);
    expect(b.items).toHaveLength(25);
    expect(b.count).toBe(25);
  });

  it("returns the remainder on page 2", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/cases?limit=25&offset=25",
      headers: { authorization: `Bearer ${token(T)}` },
    });
    const b = res.json();
    expect(b.total).toBe(30);
    expect(b.items).toHaveLength(5);
  });

  it("narrows the total to the status filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/cases?status=pending&limit=25&offset=0",
      headers: { authorization: `Bearer ${token(T)}` },
    });
    const b = res.json();
    expect(b.total).toBe(20);
  });

  it("another tenant sees total 0 (RLS)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/cases?limit=25&offset=0",
      headers: { authorization: `Bearer ${token(OTHER_T)}` },
    });
    const b = res.json();
    expect(b.total).toBe(0);
    expect(b.items).toHaveLength(0);
  });
});
