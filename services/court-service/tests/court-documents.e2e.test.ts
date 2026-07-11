/**
 * court-documents — e2e against the REAL DB as the non-superuser court_svc role.
 * Seeds a fresh tenant with a court, a case, an issued order, a cause list + two
 * cause-list items, and an issued certified copy, then GETs each of the three
 * /pdf endpoints and asserts a 200 application/pdf whose body begins with "%PDF".
 * This proves the renderers work end-to-end through the RLS-scoped read path.
 * Opt-in via COURT_E2E=1.
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
const CASE_ID = randomUUID();
const ORDER_ID = randomUUID();
const CAUSE_LIST_ID = randomUUID();
const ITEM_1 = randomUUID();
const ITEM_2 = randomUUID();
const COPY_ID = randomUUID();
const CNR = `DOC${Date.now()}`;

function token(roles: string[] = ["registrar"]): string {
  return signToken({ sub: ACTOR, tid: T, roles, sid: "sess-doc" }, SECRET, 3600);
}

function isPdf(res: { rawPayload: Buffer }): boolean {
  return res.rawPayload.subarray(0, 4).toString("latin1") === "%PDF";
}

let app: FastifyInstance;

describe.skipIf(!RUN)("court-documents PDF rendering (e2e, RLS)", () => {
  beforeAll(async () => {
    app = await buildApp();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`insert into court.courts (id, tenant_id, name, court_type)
                values (${COURT_ID}, ${T}, ${"Documents Test Court"}, ${"revenue"})`;
      await sql`insert into court.cases (id, tenant_id, cnr_number, case_type, filing_date, title, status, stage, court_id)
                values (${CASE_ID}, ${T}, ${CNR}, ${"civil"}, ${"2025-01-01"}, ${"Alpha vs. Beta"}, ${"registered"}, ${"registered"}, ${COURT_ID})`;
      await sql`insert into court.orders (id, tenant_id, case_id, order_type, order_text, signed_by, order_date, status)
                values (${ORDER_ID}, ${T}, ${CASE_ID}, ${"order"}, ${"The petition is allowed with costs."}, ${ACTOR}, ${"2026-07-05"}, ${"issued"})`;
      await sql`insert into court.cause_lists (id, tenant_id, court_id, list_date, status)
                values (${CAUSE_LIST_ID}, ${T}, ${COURT_ID}, ${"2026-07-11"}, ${"published"})`;
      await sql`insert into court.cause_list_items (id, tenant_id, cause_list_id, case_id, item_number, slot, courtroom, list_date)
                values (${ITEM_1}, ${T}, ${CAUSE_LIST_ID}, ${CASE_ID}, ${1}, ${"10:30"}, ${"Room 1"}, ${"2026-07-11"})`;
      await sql`insert into court.cause_list_items (id, tenant_id, cause_list_id, case_id, item_number, slot, courtroom, list_date)
                values (${ITEM_2}, ${T}, ${CAUSE_LIST_ID}, ${CASE_ID}, ${2}, ${"11:00"}, ${"Room 2"}, ${"2026-07-11"})`;
      await sql`insert into court.certified_copies (id, tenant_id, case_id, order_id, copies_count, status, issued_by, issued_at)
                values (${COPY_ID}, ${T}, ${CASE_ID}, ${ORDER_ID}, ${2}, ${"issued"}, ${ACTOR}, now())`;
    });
  });

  afterAll(async () => {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${T}, true)`;
      await sql`delete from court.certified_copies where tenant_id = ${T}`;
      await sql`delete from court.cause_list_items where tenant_id = ${T}`;
      await sql`delete from court.cause_lists where tenant_id = ${T}`;
      await sql`delete from court.orders where tenant_id = ${T}`;
      await sql`delete from court.cases where tenant_id = ${T}`;
      await sql`delete from court.courts where tenant_id = ${T}`;
    });
    await app.close();
    await sqlClient.end();
  });

  it("GET /v1/court/cause-lists/:id/pdf returns a PDF", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/cause-lists/${CAUSE_LIST_ID}/pdf`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(isPdf(res)).toBe(true);
  });

  it("GET /v1/court/orders/:id/pdf returns a PDF", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/orders/${ORDER_ID}/pdf`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(isPdf(res)).toBe(true);
  });

  it("GET /v1/court/certified-copies/:id/pdf returns a PDF", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/certified-copies/${COPY_ID}/pdf`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(isPdf(res)).toBe(true);
  });

  it("unknown ids 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/court/orders/${randomUUID()}/pdf`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
