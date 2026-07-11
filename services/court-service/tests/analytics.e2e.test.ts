/**
 * Court analytics summary — e2e against the REAL DB as the non-superuser
 * court_svc role. Seeds cases with known filing/disposal dates and asserts the
 * NCMS-style metrics (institution/disposal/pending, clearance rate) and RLS
 * isolation, through the real HTTP read path. Opt-in via COURT_E2E=1.
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
const ACTOR = "7777aaaa-7777-4777-8777-777777777777";
const COURT_ID = randomUUID();

function token(tid: string = T): string {
  return signToken({ sub: ACTOR, tid, roles: ["court_admin"], sid: "sess-an" }, SECRET, 3600);
}

let app: FastifyInstance;

describe.skipIf(!RUN)("court-service analytics summary (e2e, RLS)", () => {
  beforeAll(async () => {
    app = await buildApp();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`insert into court.courts (id, tenant_id, name, court_type) values (${COURT_ID}, ${T}, ${"Analytics Court"}, ${"revenue"})`;
      const mk = (cnr: string, filing: string, disposal: string | null) => sql`
        insert into court.cases (id, tenant_id, cnr_number, case_type, filing_date, title, status, stage, court_id, disposal_date)
        values (${randomUUID()}, ${T}, ${cnr}, ${"civil"}, ${filing}, ${"C"}, ${disposal ? "disposed" : "registered"}, ${disposal ? "disposed" : "registered"}, ${COURT_ID}, ${disposal})`;
      await mk(`AN1${Date.now()}`, "2026-01-10", "2026-03-10"); // instituted + disposed in period
      await mk(`AN2${Date.now()}`, "2026-02-01", null);          // pending
      await mk(`AN3${Date.now()}`, "2026-02-15", null);          // pending
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

  it("computes institution/disposal/pending + clearance rate for the period", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/cases/analytics?from=2026-01-01&to=2026-06-30",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.instituted).toBe(3);
    expect(b.disposed).toBe(1);
    expect(b.pending).toBe(2);
    expect(b.clearanceRatePct).toBeCloseTo(33.3, 1); // 1 disposed / 3 instituted
    expect(b.oldestPendingDays).toBeGreaterThanOrEqual(b.avgPendencyDays);
    expect(b.avgPendencyDays).toBeGreaterThan(0);
  });

  it("another tenant sees all-zero analytics (RLS)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/court/cases/analytics?from=2026-01-01&to=2026-06-30",
      headers: { authorization: `Bearer ${token(randomUUID())}` },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.instituted).toBe(0);
    expect(b.pending).toBe(0);
    expect(b.clearanceRatePct).toBeNull();
  });
});
