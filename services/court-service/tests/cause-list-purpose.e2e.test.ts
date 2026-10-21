/**
 * GAP-COURT-CAUSE-LIST-04: GET /v1/court/cause-lists/:id/items returns each
 * item's hearing `purpose`. e2e against the REAL DB as court_svc (FORCE RLS),
 * through the HTTP route. Opt-in via COURT_E2E=1.
 *
 * Seeds: a cancelled hearing, a hearing in ANOTHER tenant on the same case id
 * (FK checks bypass RLS, so this is the real leak scenario), a hearing on an
 * adjacent IST day, two hearings with different purposes the same day, and
 * held / IST-boundary hearings that agree.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { deriveCauseListId } from "../src/modules/cause-list/domain.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET as string; // injected by vitest.config.ts

const T = randomUUID();
const T2 = randomUUID();
const ACTOR = "9999aaaa-9999-4999-8999-999999999999";
const COURT_ID = randomUUID();
const LIST_DATE = "2026-05-10";
const LIST_ID = deriveCauseListId(T, COURT_ID, LIST_DATE);

const CASES = {
  cancelledPlusScheduled: randomUUID(),
  adjacentDayOnly: randomUUID(),
  conflicting: randomUUID(),
  otherTenantOnly: randomUUID(),
  heldAgreeing: randomUUID(),
  noHearing: randomUUID(),
} as const;

const token = (tid: string) =>
  signToken({ sub: ACTOR, tid, roles: ["registrar"], sid: "sess-pur" }, SECRET, 3600);

let app: FastifyInstance;

// FLAKY-SKIP: Requires COURT_E2E=1 plus a live court-service stack (real Postgres); unset in standard CI runs without it. (expires: 2026-12-13)
describe.skipIf(!RUN)("court-service cause-list item purpose (e2e, RLS)", () => {
  beforeAll(async () => {
    app = await buildApp();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`insert into court.courts (id, tenant_id, name, court_type) values (${COURT_ID}, ${T}, ${"Purpose Court"}, ${"revenue"})`;
      await sql`insert into court.cause_lists (id, tenant_id, court_id, list_date, status) values (${LIST_ID}, ${T}, ${COURT_ID}, ${LIST_DATE}, ${"draft"})`;
      let n = 0;
      for (const caseId of Object.values(CASES)) {
        n += 1;
        await sql`insert into court.cases (id, tenant_id, cnr_number) values (${caseId}, ${T}, ${"CNR" + randomUUID().slice(0, 12)})`;
        const itemId = randomUUID();
        await sql`insert into court.cause_list_items (id, tenant_id, cause_list_id, case_id, item_number, slot, courtroom, list_date)
                  values (${itemId}, ${T}, ${LIST_ID}, ${caseId}, ${n}, ${"S-" + n}, ${"R" + n}, ${LIST_DATE})`;
      }
      const h = (caseId: string, at: string, status: string, purpose: string | null) =>
        sql`insert into court.hearings (id, tenant_id, case_id, scheduled_date, status, purpose)
            values (${randomUUID()}, ${T}, ${caseId}, ${at}, ${status}, ${purpose})`;
      await h(CASES.cancelledPlusScheduled, "2026-05-10T04:00:00Z", "cancelled", "cancelled_purpose");
      await h(CASES.cancelledPlusScheduled, "2026-05-10T05:00:00Z", "scheduled", "arguments");
      // 2026-05-10T19:00Z is 2026-05-11 00:30 IST -> adjacent day, must not match
      await h(CASES.adjacentDayOnly, "2026-05-10T19:00:00Z", "scheduled", "adjacent_purpose");
      await h(CASES.conflicting, "2026-05-10T05:00:00Z", "scheduled", "arguments");
      await h(CASES.conflicting, "2026-05-10T06:00:00Z", "scheduled", "evidence");
      // 2026-05-09T19:00Z is 2026-05-10 00:30 IST -> same IST day as the list
      await h(CASES.heldAgreeing, "2026-05-09T19:00:00Z", "held", "final_hearing");
      await h(CASES.heldAgreeing, "2026-05-10T07:00:00Z", "adjourned", "final_hearing");
    });
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T2}, true)`;
      // Another tenant's hearing pointing at tenant T's case id (FK ignores RLS).
      await sql`insert into court.hearings (id, tenant_id, case_id, scheduled_date, status, purpose)
                values (${randomUUID()}, ${T2}, ${CASES.otherTenantOnly}, ${"2026-05-10T05:00:00Z"}, ${"scheduled"}, ${"leaked_purpose"})`;
      await sql`insert into court.hearings (id, tenant_id, case_id, scheduled_date, status, purpose)
                values (${randomUUID()}, ${T2}, ${CASES.heldAgreeing}, ${"2026-05-10T05:00:00Z"}, ${"scheduled"}, ${"leaked_purpose"})`;
    });
  });

  afterAll(async () => {
    // T2 hearings reference T cases, so remove them first.
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T2}, true)`;
      await sql`delete from court.hearings where tenant_id = ${T2}`;
    });
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`delete from court.hearings where tenant_id = ${T}`;
      await sql`delete from court.cause_list_items where tenant_id = ${T}`;
      await sql`delete from court.cause_lists where tenant_id = ${T}`;
      await sql`delete from court.cases where tenant_id = ${T}`;
      await sql`delete from court.courts where tenant_id = ${T}`;
    });
    await app.close();
    await sqlClient.end();
  });

  it("returns the right purpose / null per item and never leaks another tenant's purpose", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/cause-lists/${LIST_ID}/items`,
      headers: { authorization: `Bearer ${token(T)}` },
    });
    expect(res.statusCode).toBe(200);
    const byCase = new Map<string, { purpose: unknown; slot: unknown }>(
      res.json().items.map((i: { caseId: string; purpose: unknown; slot: unknown }) => [i.caseId, i]),
    );
    expect(byCase.size).toBe(6);
    expect(byCase.get(CASES.cancelledPlusScheduled)?.purpose).toBe("arguments"); // cancelled excluded
    expect(byCase.get(CASES.adjacentDayOnly)?.purpose).toBeNull(); // adjacent IST day
    expect(byCase.get(CASES.conflicting)?.purpose).toBeNull(); // ambiguous
    expect(byCase.get(CASES.otherTenantOnly)?.purpose).toBeNull(); // other tenant only
    expect(byCase.get(CASES.heldAgreeing)?.purpose).toBe("final_hearing"); // held+adjourned agree; T2 row ignored
    expect(byCase.get(CASES.noHearing)?.purpose).toBeNull();
    expect(byCase.get(CASES.noHearing)?.slot).toMatch(/^S-/); // existing fields intact
    expect(JSON.stringify(res.json())).not.toContain("leaked_purpose");
  });
});
