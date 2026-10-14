/**
 * Inward (DAK) and dispatch registers: server-side search and paging, against a real database.
 *
 * GAP-ESTAB-DAK-04 / GAP-ESTAB-DISPATCH-04: the web registers fetched limit=100 once and
 * searched/paged that slice in the browser, so older entries were unreachable. The list routes
 * now take `offset` and `q` and return `pagination.total`.
 *
 * Given 250 inward rows and 130 dispatch rows (and another tenant's rows), When the register
 * is paged and searched through the HTTP boundary, Then every row is reachable, an old barcode
 * is found by search, LIKE metacharacters in the term are literal, and nothing from another
 * tenant ever appears.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "c0ff33aa-0000-4000-8000-0000000005a1";
const OTHER_TENANT = "c0ff33aa-0000-4000-8000-0000000005a2";
const ACTOR = randomUUID();

const token = (roles: string[], tid = TENANT) => signToken({ sub: ACTOR, tid, roles, sid: "sess-register-paging" }, SECRET);
const auth = (roles: string[] = ["estab_officer"]) => ({ authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT });

let app: FastifyInstance;

async function wipe(sql: typeof sqlClient) {
  for (const t of [TENANT, OTHER_TENANT]) {
    await sql`select set_config('app.tenant_id', ${t}, true)`;
    await sql`DELETE FROM files.estab_inward WHERE tenant_id = ${t}`;
    await sql`DELETE FROM files.estab_dispatch WHERE tenant_id = ${t}`;
  }
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await wipe(sql as unknown as typeof sqlClient);
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    // 250 inward rows, one per day going back, DAK/2026/0000 newest.
    for (let i = 0; i < 250; i++) {
      await sql`
        INSERT INTO files.estab_inward (tenant_id, dak_no, from_address, subject, received_at, barcode, status, created_by, updated_by)
        VALUES (${TENANT}, ${"DAK/2026/" + String(i).padStart(4, "0")}, ${i === 200 ? "Ministry of Rural Development" : "Sender " + i},
                ${i === 77 ? "100% pure_water scheme" : "Subject " + i}, now() - (${i} || ' hours')::interval,
                ${"BC-" + String(i).padStart(4, "0")}, 'received', ${ACTOR}, ${ACTOR})`;
    }
    for (let i = 0; i < 130; i++) {
      await sql`
        INSERT INTO files.estab_dispatch (tenant_id, dispatch_no, to_address, subject, mode, dispatched_at, status, delivery_status, created_by, updated_by)
        VALUES (${TENANT}, ${"DSP/2026/" + String(i).padStart(4, "0")}, ${i === 120 ? "The Registrar, High Court" : "Addressee " + i},
                ${"Dispatch subject " + i}, 'post', now() - (${i} || ' hours')::interval, 'dispatched', 'sent', ${ACTOR}, ${ACTOR})`;
    }
    await sql`select set_config('app.tenant_id', ${OTHER_TENANT}, true)`;
    await sql`
      INSERT INTO files.estab_inward (tenant_id, dak_no, from_address, subject, barcode, status, created_by, updated_by)
      VALUES (${OTHER_TENANT}, 'DAK/OTHER/1', 'Other tenant sender', 'Other tenant subject', 'BC-0200', 'received', ${ACTOR}, ${ACTOR})`;
    await sql`
      INSERT INTO files.estab_dispatch (tenant_id, dispatch_no, to_address, subject, mode, status, created_by, updated_by)
      VALUES (${OTHER_TENANT}, 'DSP/OTHER/1', 'Other tenant addressee', 'Other tenant dispatch', 'post', 'dispatched', ${ACTOR}, ${ACTOR})`;
  });
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (sql) => { await wipe(sql as unknown as typeof sqlClient); });
  await sqlClient.end();
});

const get = async (url: string, roles?: string[]) => app.inject({ method: "GET", url, headers: auth(roles) });

describe("GET /v1/estab/inward — server-side paging and search", () => {
  it("Given 250 rows, When paged 100 at a time, Then every row is reachable exactly once and total is 250", async () => {
    const seen = new Set<string>();
    for (const offset of [0, 100, 200]) {
      const res = await get(`/v1/estab/inward?limit=100&offset=${offset}`);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Array<{ dakNo: string }>; pagination: { total: number; hasMore: boolean; offset: number; pageSize: number } };
      expect(body.pagination).toMatchObject({ total: 250, offset, pageSize: 100 });
      expect(body.pagination.hasMore).toBe(offset < 200);
      for (const r of body.data) seen.add(r.dakNo);
    }
    expect(seen.size).toBe(250);
  });

  it("pages are newest first, so offset 0 starts at the most recently received DAK", async () => {
    const res = await get("/v1/estab/inward?limit=3");
    expect((res.json() as { data: Array<{ dakNo: string }> }).data.map((r) => r.dakNo)).toEqual(["DAK/2026/0000", "DAK/2026/0001", "DAK/2026/0002"]);
  });

  it("Given an old entry beyond the first 100, When its barcode is searched, Then it is found (and only it)", async () => {
    const res = await get("/v1/estab/inward?limit=50&q=BC-0200");
    const body = res.json() as { data: Array<{ dakNo: string; barcode: string }>; pagination: { total: number } };
    expect(body.data.map((r) => r.barcode)).toEqual(["BC-0200"]);
    expect(body.pagination.total).toBe(1);
  });

  it("search is case-insensitive and also matches sender, subject and DAK number", async () => {
    const bySender = (await get("/v1/estab/inward?q=rural%20development")).json() as { data: Array<{ dakNo: string }> };
    expect(bySender.data.map((r) => r.dakNo)).toEqual(["DAK/2026/0200"]);
    const byDak = (await get("/v1/estab/inward?q=dak/2026/0042")).json() as { data: Array<{ dakNo: string }> };
    expect(byDak.data.map((r) => r.dakNo)).toEqual(["DAK/2026/0042"]);
    const bySubject = (await get("/v1/estab/inward?q=SUBJECT%20249")).json() as { data: Array<{ dakNo: string }> };
    expect(bySubject.data.map((r) => r.dakNo)).toEqual(["DAK/2026/0249"]);
  });

  it("LIKE metacharacters in the term are literal: '%' and '_' do not match everything", async () => {
    const pct = (await get("/v1/estab/inward?q=%25")).json() as { data: Array<{ subject: string }>; pagination: { total: number } };
    expect(pct.pagination.total).toBe(1);
    expect(pct.data[0]!.subject).toBe("100% pure_water scheme");
    const underscore = (await get("/v1/estab/inward?q=_")).json() as { pagination: { total: number } };
    expect(underscore.pagination.total).toBe(1);
  });

  it("never returns another tenant's rows, even for a term only they match", async () => {
    const res = await get("/v1/estab/inward?q=Other%20tenant");
    expect((res.json() as { data: unknown[]; pagination: { total: number } }).data).toEqual([]);
    const all = (await get("/v1/estab/inward?limit=500")).json() as { data: Array<{ dakNo: string }>; pagination: { total: number } };
    expect(all.pagination.total).toBe(250);
    expect(all.data.some((r) => r.dakNo === "DAK/OTHER/1")).toBe(false);
  });

  it("an audit officer can read the register; a role with no estab access gets 403", async () => {
    expect((await get("/v1/estab/inward?limit=1", ["audit_officer"])).statusCode).toBe(200);
    expect((await get("/v1/estab/inward?limit=1", ["citizen"])).statusCode).toBe(403);
  });

  it("rejects a bad paging query with 400, not a 500", async () => {
    expect((await get("/v1/estab/inward?offset=-1")).statusCode).toBe(400);
    expect((await get("/v1/estab/inward?limit=0")).statusCode).toBe(400);
    expect((await get(`/v1/estab/inward?q=${"x".repeat(101)}`)).statusCode).toBe(400);
  });
});

describe("GET /v1/estab/dispatch — server-side paging and search", () => {
  it("Given 130 rows, When paged 50 at a time, Then every row is reachable once and total is 130", async () => {
    const seen = new Set<string>();
    for (const offset of [0, 50, 100]) {
      const res = await get(`/v1/estab/dispatch?limit=50&offset=${offset}`);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Array<{ dispatchNo: string }>; pagination: { total: number; hasMore: boolean } };
      expect(body.pagination.total).toBe(130);
      expect(body.pagination.hasMore).toBe(offset < 100);
      for (const r of body.data) seen.add(r.dispatchNo);
    }
    expect(seen.size).toBe(130);
  });

  it("an old dispatch is found by addressee, and another tenant's dispatch never is", async () => {
    const found = (await get("/v1/estab/dispatch?q=high%20court")).json() as { data: Array<{ dispatchNo: string }> };
    expect(found.data.map((r) => r.dispatchNo)).toEqual(["DSP/2026/0120"]);
    const other = (await get("/v1/estab/dispatch?q=Other%20tenant")).json() as { data: unknown[] };
    expect(other.data).toEqual([]);
  });

  it("a read-only audit officer may read; an unrelated role gets 403", async () => {
    expect((await get("/v1/estab/dispatch?limit=1", ["audit_officer"])).statusCode).toBe(200);
    expect((await get("/v1/estab/dispatch?limit=1", ["citizen"])).statusCode).toBe(403);
  });
});
