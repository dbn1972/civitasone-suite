/**
 * GAP-COURT-CAUSE-LIST-02: GET /v1/court/cause-lists?courtId&listDate re-opens
 * the (deterministic) cause-list for a court on a date, so the console can
 * resume after reload rather than POST a duplicate. e2e against the REAL DB as
 * court_svc (RLS). Opt-in via COURT_E2E=1 (DATABASE_URL → localhost:5672).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { deriveCauseListId } from "../src/modules/cause-list/domain.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

const T = randomUUID();
const ACTOR = "9999aaaa-9999-4999-8999-999999999999";
const COURT_ID = randomUUID();
const LIST_DATE = "2026-05-10";

function token(tid: string = T): string {
  return signToken({ sub: ACTOR, tid, roles: ["registrar"], sid: "sess-cl" }, SECRET, 3600);
}

let app: FastifyInstance;

// FLAKY-SKIP: Requires COURT_E2E=1 plus a live court-service stack (real Postgres + HTTP); unset in standard CI so this e2e suite never executes there. (expires: 2026-12-13)
describe.skipIf(!RUN)("court-service cause-list lookup (e2e, RLS)", () => {
  beforeAll(async () => {
    app = await buildApp();
    const id = deriveCauseListId(T, COURT_ID, LIST_DATE);
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`insert into court.courts (id, tenant_id, name, court_type) values (${COURT_ID}, ${T}, ${"Lookup Court"}, ${"revenue"})`;
      await sql`insert into court.cause_lists (id, tenant_id, court_id, list_date, status) values (${id}, ${T}, ${COURT_ID}, ${LIST_DATE}, ${"draft"})`;
    });
  });

  afterAll(async () => {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`delete from court.cause_lists where tenant_id = ${T}`;
      await sql`delete from court.courts where tenant_id = ${T}`;
    });
    await app.close();
    await sqlClient.end();
  });

  it("returns the existing list for a court/date", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/cause-lists?courtId=${COURT_ID}&listDate=${LIST_DATE}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.exists).toBe(true);
    expect(b.causeList?.id).toBe(deriveCauseListId(T, COURT_ID, LIST_DATE));
  });

  it("returns exists:false for a date with no list", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/cause-lists?courtId=${COURT_ID}&listDate=2026-05-11`,
      headers: { authorization: `Bearer ${token()}` },
    });
    const b = res.json();
    expect(b.exists).toBe(false);
    expect(b.causeList).toBeNull();
  });

  it("another tenant cannot see the list (RLS)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/cause-lists?courtId=${COURT_ID}&listDate=${LIST_DATE}`,
      headers: { authorization: `Bearer ${token(randomUUID())}` },
    });
    const b = res.json();
    expect(b.exists).toBe(false);
  });
});
