/**
 * GET /v1/estab/dashboard — one SLA / pendency definition, against a real database.
 *
 * GAP-ESTAB-DASHBOARD-01: the dashboard's "SLA Breached" counted only status='active' files and
 * compared the raw due timestamp to the server clock, while My Desk and the file register count
 * every open file whose due date (an IST calendar day) is before today. Both now use:
 *   open     = status not in (closed, archived, disposed)
 *   overdue  = open AND due-date IST day < today IST
 *   pendency = IST calendar days since creation, averaged over open files (one decimal)
 *
 * Given a mix of files in one tenant (and an overdue open file in another), When the dashboard is
 * read, Then closed/archived files never count, a file due today is not overdue, a draft past due
 * is, the average ignores closed files, and the other tenant's file is invisible.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c0ff33aa-0000-4000-8000-0000000005b1";
const OTHER_TENANT = "c0ff33aa-0000-4000-8000-0000000005b2";
const BOUNDARY_TENANT = "c0ff33aa-0000-4000-8000-0000000005b3";
const ACTOR = randomUUID();

const headers = (roles: string[] = ["estab_officer"], tenant: string = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "sess-dashboard-sla" }, SECRET)}`,
  "x-tenant-id": tenant,
});

let app: FastifyInstance;

type Seed = { no: string; status: string; due: string | null; created: string };

async function seed(sql: typeof sqlClient, tenant: string, rows: Seed[]) {
  await sql`select set_config('app.tenant_id', ${tenant}, true)`;
  for (const r of rows) {
    await sql`
      INSERT INTO files.estab_files (tenant_id, file_no, subject, dept, current_with, status, due_by, created_at, created_by, updated_by)
      VALUES (${tenant}, ${r.no}, ${"Subject " + r.no}, 'ADMIN', ${ACTOR}, ${r.status},
              ${r.due === null ? null : sql`now() - ${r.due}::interval`}, now() - ${r.created}::interval, ${ACTOR}, ${ACTOR})`;
  }
}

async function wipe(sql: typeof sqlClient) {
  for (const t of [TENANT, OTHER_TENANT, BOUNDARY_TENANT]) {
    await sql`select set_config('app.tenant_id', ${t}, true)`;
    await sql`DELETE FROM files.estab_files WHERE tenant_id = ${t}`;
  }
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    const tx = sql as unknown as typeof sqlClient;
    await wipe(tx);
    await seed(tx, TENANT, [
      { no: "SLA/1", status: "active",   due: "25 hours", created: "10 days" },  // overdue (due yesterday IST or earlier)
      { no: "SLA/2", status: "draft",    due: "3 days",   created: "20 days" },  // overdue: a draft is open
      { no: "SLA/3", status: "active",   due: "0 hours",  created: "0 hours" },  // due today: NOT overdue
      { no: "SLA/4", status: "closed",   due: "30 days",  created: "100 days" }, // closed: excluded everywhere
      { no: "SLA/5", status: "archived", due: "30 days",  created: "200 days" }, // archived: excluded everywhere
      { no: "SLA/6", status: "active",   due: null,       created: "30 days" },  // no due date: never overdue
    ]);
    await seed(tx, OTHER_TENANT, [
      { no: "SLA/OTHER", status: "active", due: "9 days", created: "40 days" },
    ]);
    // IST day boundaries: 00:30 IST today is still "today" (its UTC date is yesterday's), 23:30 IST
    // yesterday is already overdue. Given as IST wall-clock instants so the case does not depend on
    // when the suite runs.
    await tx`select set_config('app.tenant_id', ${BOUNDARY_TENANT}, true)`;
    await tx`
      INSERT INTO files.estab_files (tenant_id, file_no, subject, dept, current_with, status, due_by, created_at, created_by, updated_by)
      VALUES
        (${BOUNDARY_TENANT}, 'IST/AFTER', 'Due just after IST midnight', 'ADMIN', ${ACTOR}, 'active',
          (((now() AT TIME ZONE 'Asia/Kolkata')::date + interval '30 minutes') AT TIME ZONE 'Asia/Kolkata'),
          (((now() AT TIME ZONE 'Asia/Kolkata')::date + interval '30 minutes') AT TIME ZONE 'Asia/Kolkata'), ${ACTOR}, ${ACTOR}),
        (${BOUNDARY_TENANT}, 'IST/BEFORE', 'Due just before IST midnight', 'ADMIN', ${ACTOR}, 'active',
          (((now() AT TIME ZONE 'Asia/Kolkata')::date - interval '30 minutes') AT TIME ZONE 'Asia/Kolkata'),
          (((now() AT TIME ZONE 'Asia/Kolkata')::date - interval '30 minutes') AT TIME ZONE 'Asia/Kolkata'), ${ACTOR}, ${ACTOR})`;
  });
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (sql) => { await wipe(sql as unknown as typeof sqlClient); });
  await sqlClient.end();
});

describe("GET /v1/estab/dashboard — shared SLA / pendency definition", () => {
  it("counts open overdue files only: closed and archived never, due-today not, draft past due yes", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slaBreached: number; avgPendencyDays: number; filesPending: number };
    expect(body.slaBreached).toBe(2);
  });

  it("averages pendency over open files only, in whole IST days, to one decimal", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers() });
    // Open files: 10, 20, 0 and 30 days old -> 15. The closed (100) and archived (200) files are ignored.
    expect((res.json() as { avgPendencyDays: number }).avgPendencyDays).toBe(15);
  });

  // GAP-ESTAB-DASHBOARD-05: the pendency snapshot's own figures, which no stat tile shows.
  it("'openFiles' counts every open file at any stage (active and draft), never closed or archived", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers() });
    // SLA/1, SLA/2 (draft), SLA/3, SLA/6 are open; SLA/4 (closed) and SLA/5 (archived) are not.
    // 'filesPending' (status active only) stays 3, so the two differ by the draft file.
    const body = res.json() as { openFiles: number; filesPending: number };
    expect(body.openFiles).toBe(4);
    expect(body.filesPending).toBe(3);
  });

  it("'oldestPendencyDays' is the age in whole IST days of the oldest OPEN file (closed and archived files are older and ignored)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers() });
    // Open files are 10, 20, 0 and 30 days old; the closed (100) and archived (200) ones must not win.
    expect((res.json() as { oldestPendencyDays: number }).oldestPendencyDays).toBe(30);
  });

  it("'filesPending' is the count of status='active' files, the figure the register's Active Files tile shows", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers() });
    expect((res.json() as { filesPending: number }).filesPending).toBe(3);
  });

  it("GAP-ESTAB-DASHBOARD-02: 'filesActive' is the same count under its true name, and 'filesPending' is only its deprecated alias", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers() });
    const body = res.json() as { filesActive: number; filesPending: number };
    expect(body.filesActive).toBe(3);
    expect(body.filesPending).toBe(body.filesActive);
  });

  it("never reads another tenant's files", async () => {
    // The other tenant's overdue open file (9 days past due) would make these 3 and 18.75 if it leaked.
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers() });
    const body = res.json() as { slaBreached: number; avgPendencyDays: number; openFiles: number; oldestPendencyDays: number };
    expect(body.slaBreached).toBe(2);
    expect(body.avgPendencyDays).toBe(15);
    // ...and its 40-day-old open file would make these 5 and 40.
    expect(body.openFiles).toBe(4);
    expect(body.oldestPendencyDays).toBe(30);
  });

  it("an empty tenant reads zero, not an error", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/dashboard",
      headers: { authorization: `Bearer ${signToken({ sub: ACTOR, tid: "c0ff33aa-0000-4000-8000-0000000005b9", roles: ["estab_officer"], sid: "s" }, SECRET)}`, "x-tenant-id": "c0ff33aa-0000-4000-8000-0000000005b9" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ slaBreached: 0, avgPendencyDays: 0, filesPending: 0, openFiles: 0, oldestPendencyDays: 0 });
  });

  it("a role outside the estab set is refused", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/estab/dashboard — IST calendar days, not UTC dates (GAP-ESTAB-DASHBOARD-01)", () => {
  it("a file due 00:30 IST today is not overdue; one due 23:30 IST yesterday is", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers(["estab_officer"], BOUNDARY_TENANT) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { slaBreached: number }).slaBreached).toBe(1);
  });

  it("pendency counts IST days since creation: 0 (created 00:30 IST today) and 1 (created 23:30 IST yesterday) average 0.5", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard", headers: headers(["estab_officer"], BOUNDARY_TENANT) });
    expect((res.json() as { avgPendencyDays: number }).avgPendencyDays).toBe(0.5);
  });
});
