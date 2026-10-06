/**
 * GAP-COURT-HEARINGS-03 + GAP-COURT-HEARINGS-02: the flat hearings day view
 * (GET /v1/court/hearings?from&to&status) and case free-text search
 * (GET /v1/court/cases?q=). e2e against the REAL DB as court roles (RLS).
 * Opt-in via COURT_E2E=1 (DATABASE_URL → localhost:5672).
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
const ACTOR = "abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd";
const COURT_ID = randomUUID();
const CASE_1 = randomUUID();
const CASE_2 = randomUUID();
const TODAY = new Date().toISOString().slice(0, 10);

function token(tid: string = T, roles: string[] = ["court_admin"]): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-h" }, SECRET, 3600);
}

let app: FastifyInstance;

// FLAKY-SKIP: Requires COURT_E2E=1 plus a live court-service stack (real Postgres + HTTP); unset in standard CI so this e2e suite never executes there. (expires: 2026-12-13)
describe.skipIf(!RUN)("court-service flat hearings + case search (e2e, RLS)", () => {
  beforeAll(async () => {
    app = await buildApp();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`insert into court.courts (id, tenant_id, name, court_type) values (${COURT_ID}, ${T}, ${"H Court"}, ${"revenue"})`;
      await sql`insert into court.cases (id, tenant_id, cnr_number, case_type, filing_date, title, status, court_id)
                values (${CASE_1}, ${T}, ${"HSEARCH" + Date.now()}, ${"civil"}, ${"2026-01-01"}, ${"Mehta Partition Suit"}, ${"pending"}, ${COURT_ID})`;
      await sql`insert into court.cases (id, tenant_id, cnr_number, case_type, filing_date, title, status, court_id)
                values (${CASE_2}, ${T}, ${"HOTHER" + Date.now()}, ${"civil"}, ${"2026-01-01"}, ${"Verma Revenue Appeal"}, ${"pending"}, ${COURT_ID})`;
      // One hearing today, one next year.
      await sql`insert into court.hearings (id, tenant_id, case_id, scheduled_date, status, purpose)
                values (${randomUUID()}, ${T}, ${CASE_1}, ${`${TODAY}T04:30:00Z`}, ${"scheduled"}, ${"arguments"})`;
      await sql`insert into court.hearings (id, tenant_id, case_id, scheduled_date, status, purpose)
                values (${randomUUID()}, ${T}, ${CASE_2}, ${"2099-01-01T04:30:00Z"}, ${"scheduled"}, ${"framing"})`;
    });
  });

  afterAll(async () => {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`delete from court.hearings where tenant_id = ${T}`;
      await sql`delete from court.cases where tenant_id = ${T}`;
      await sql`delete from court.courts where tenant_id = ${T}`;
    });
    await app.close();
    await sqlClient.end();
  });

  it("returns only today's hearings for a from=to=today range", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/hearings?from=${TODAY}&to=${TODAY}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.total).toBe(1);
    expect(b.items).toHaveLength(1);
    expect(b.items[0].caseId).toBe(CASE_1);
  });

  it("another tenant sees no hearings (RLS)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/hearings?from=${TODAY}&to=${TODAY}`,
      headers: { authorization: `Bearer ${token(randomUUID())}` },
    });
    expect(res.json().total).toBe(0);
  });

  it("case search q= matches title case-insensitively", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/cases?q=partition&limit=25`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.total).toBe(1);
    expect(b.items[0].id).toBe(CASE_1);
  });

  it("case search escapes LIKE wildcards (a literal % matches nothing here)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/cases?q=${encodeURIComponent("%")}&limit=25`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.json().total).toBe(0);
  });
});
