/**
 * Overdue / pendency MIS reads — e2e against the REAL DB as the non-superuser
 * court_svc role. Seeds three cases for a fresh tenant (one overdue, one future,
 * one disposed-though-past) and asserts the overdue read returns exactly the
 * overdue one and pendency counts only undisposed cases — RLS-scoped, through
 * the real HTTP read path. Opt-in via COURT_E2E=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const T = randomUUID();
const ACTOR = "6666aaaa-6666-4666-8666-666666666666";
const COURT_ID = randomUUID();
const OVERDUE_CNR = `OVR${Date.now()}`;
const FUTURE_CNR = `FUT${Date.now()}`;
const DISPOSED_CNR = `DIS${Date.now()}`;

function token(roles: string[] = ["court_admin"]): string {
  return signToken({ sub: ACTOR, tid: T, roles, sid: "sess-ov" }, SECRET, 3600);
}

let app: FastifyInstance;

describe.skipIf(!RUN)("court-service overdue / pendency MIS reads (e2e, RLS)", () => {
  beforeAll(async () => {
    app = await buildApp();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`insert into court.courts (id, tenant_id, name, court_type)
                values (${COURT_ID}, ${T}, ${"MIS Test Court"}, ${"revenue"})`;
      const base = { t: T, court: COURT_ID };
      // overdue: target in the past, not disposed
      await sql`insert into court.cases (id, tenant_id, cnr_number, case_type, filing_date, title, status, stage, court_id, target_disposal_date, disposal_date)
                values (${randomUUID()}, ${base.t}, ${OVERDUE_CNR}, ${"civil"}, ${"2020-01-01"}, ${"Overdue Case"}, ${"registered"}, ${"registered"}, ${base.court}, ${"2020-06-30"}, ${null})`;
      // future: target ahead, not disposed
      await sql`insert into court.cases (id, tenant_id, cnr_number, case_type, filing_date, title, status, stage, court_id, target_disposal_date, disposal_date)
                values (${randomUUID()}, ${base.t}, ${FUTURE_CNR}, ${"civil"}, ${"2026-01-01"}, ${"Future Case"}, ${"registered"}, ${"registered"}, ${base.court}, ${"2999-01-01"}, ${null})`;
      // disposed: target in the past BUT disposed → NOT overdue, NOT pending
      await sql`insert into court.cases (id, tenant_id, cnr_number, case_type, filing_date, title, status, stage, court_id, target_disposal_date, disposal_date)
                values (${randomUUID()}, ${base.t}, ${DISPOSED_CNR}, ${"civil"}, ${"2019-01-01"}, ${"Disposed Case"}, ${"disposed"}, ${"disposed"}, ${base.court}, ${"2019-06-30"}, ${"2019-05-01"})`;
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

  it("overdue returns exactly the past-target, undisposed case (as of 2026-07-11)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/cases/overdue?asOf=2026-07-11",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const cnrs = (res.json().items as Array<{ cnrNumber: string }>).map((c) => c.cnrNumber);
    expect(cnrs).toContain(OVERDUE_CNR);
    expect(cnrs).not.toContain(FUTURE_CNR);   // target in the future
    expect(cnrs).not.toContain(DISPOSED_CNR); // already disposed
  });

  it("pendency counts only undisposed cases (2 pending: overdue + future)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/cases/pendency",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(2); // disposed case excluded
  });

  it("another tenant sees zero overdue/pendency (RLS)", async () => {
    const otherToken = signToken({ sub: ACTOR, tid: randomUUID(), roles: ["court_admin"], sid: "s" }, SECRET, 3600);
    const ov = await app.inject({ method: "GET", url: "/v1/court/cases/overdue?asOf=2026-07-11", headers: { authorization: `Bearer ${otherToken}` } });
    expect(ov.json().count).toBe(0);
    const pd = await app.inject({ method: "GET", url: "/v1/court/cases/pendency", headers: { authorization: `Bearer ${otherToken}` } });
    expect(pd.json().total).toBe(0);
  });
});
