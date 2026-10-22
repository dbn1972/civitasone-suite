/**
 * Real-DB regression guard for GAP-HR-ICC-05 (register paging, true total and
 * whole-register stat counts) and the summary half of GAP-HR-ICC-01 (the
 * free-text summary is shown only to an icc_member, never to an hr_admin just
 * because a row's `confidential` flag is false).
 *
 * Seeds directly (Drizzle insert) -- this file is about the LIST route's
 * query/response shape. The F3 write path is covered by
 * icc-list-detail-masking-real-db.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsIccComplaints } from "../modules/disciplinary/schema.js";
import type { FastifyInstance } from "fastify";

// Set by this package's vitest config (env.JWT_SECRET); never a literal here.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ICC_MEMBER = randomUUID();
const HR_ADMIN = randomUUID();
const SUMMARY = "Seeded POSH complaint summary text naming nobody in particular";

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-icc-page" }, SECRET, 3600)}` };
}
const get = (qs: string, sub = ICC_MEMBER, roles = ["icc_member"]) =>
  app.inject({ method: "GET", url: `/v1/hrms/icc/complaints${qs}`, headers: auth(sub, roles) });

let app: FastifyInstance;
const OPEN_TO_HR_ADMIN_IDS = new Set<string>();
let nonConfidentialOpenId: string;

// 120 complaints, using exactly the statuses the column's check constraint allows:
// 70 filed, 20 under inquiry (15 investigating + 5 hearing), 30 disposed (10 each
// resolved / dismissed / withdrawn).
const STATUS_PLAN: Array<[string, number]> = [
  ["filed", 70], ["investigating", 15], ["hearing", 5], ["resolved", 10], ["dismissed", 10], ["withdrawn", 10],
];

beforeAll(async () => {
  app = await buildApp();
  const complainant = randomUUID();
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const rows: Array<typeof hrmsIccComplaints.$inferInsert> = [];
  let n = 0;
  for (const [status, count] of STATUS_PLAN) {
    for (let i = 0; i < count; i++) {
      const id = randomUUID();
      // 30 rows are visible to a non-member (icc_members_only = false): 25 filed + 5 resolved;
      // exactly one of those is also confidential = false.
      const visibleToHrAdmin = (status === "filed" && i < 25) || (status === "resolved" && i < 5);
      if (visibleToHrAdmin) OPEN_TO_HR_ADMIN_IDS.add(id);
      const nonConfidential = status === "filed" && i === 0;
      if (nonConfidential) nonConfidentialOpenId = id;
      rows.push({
        id, tenantId: TENANT, complainantId: complainant, respondentId: randomUUID(), summary: SUMMARY,
        filedAt: new Date(base + n * 60_000), status, caseNo: `ICC/2026/${String(n + 1).padStart(3, "0")}`,
        confidential: !nonConfidential, iccMembersOnly: !visibleToHrAdmin, createdBy: ICC_MEMBER,
      });
      n++;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, async (tx: any) => {
    await tx.insert(hrmsIccComplaints).values(rows);
  });
}, 60_000);

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/icc/complaints -- limit / offset / total (GAP-HR-ICC-05)", () => {
  it("120 complaints: the first page is 100 rows, the second the remaining 20, total 120 on both -- none lost or repeated", async () => {
    const p1 = (await get("?limit=100&offset=0")).json();
    expect(p1.data).toHaveLength(100);
    expect(p1.total).toBe(120);
    const p2 = (await get("?limit=100&offset=100")).json();
    expect(p2.data).toHaveLength(20);
    expect(p2.total).toBe(120);
    const ids = [...p1.data, ...p2.data].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(120);
  });

  it("is newest-first and the default page size is still 100", async () => {
    const body = (await get("")).json();
    expect(body.data).toHaveLength(100);
    const times = body.data.map((r: { filedAt: string }) => Date.parse(r.filedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("a page past the end is empty but the total and stats are still the real ones", async () => {
    const res = (await get("?limit=100&offset=500")).json();
    expect(res.data).toEqual([]);
    expect(res.total).toBe(120);
    expect(res.stats).toEqual({ filed: 70, underInquiry: 20, disposed: 30 });
  });

  it("rejects an out-of-range limit or a negative offset (400)", async () => {
    expect((await get("?limit=201")).statusCode).toBe(400);
    expect((await get("?limit=0")).statusCode).toBe(400);
    expect((await get("?offset=-1")).statusCode).toBe(400);
  });
});

describe("GET /v1/hrms/icc/complaints -- whole-register stat counts (GAP-HR-ICC-05)", () => {
  it("counts every complaint by bucket, not just the 10 rows on this page", async () => {
    const res = (await get("?limit=10&offset=0")).json();
    expect(res.data).toHaveLength(10);
    expect(res.stats).toEqual({ filed: 70, underInquiry: 20, disposed: 30 });
    expect(res.stats.filed + res.stats.underInquiry + res.stats.disposed).toBe(res.total);
  });

  it("a non-member's counts cover only the rows that caller can see (icc_members_only = false)", async () => {
    const res = (await get("?limit=10", HR_ADMIN, ["hr_admin"])).json();
    expect(res.total).toBe(30);
    expect(res.stats).toEqual({ filed: 25, underInquiry: 0, disposed: 5 });
  });
});

describe("GET /v1/hrms/icc/complaints -- summary only for an icc_member (GAP-HR-ICC-01)", () => {
  it("an hr_admin gets summary:null even for the non-confidential row they CAN see", async () => {
    const res = (await get("?limit=200", HR_ADMIN, ["hr_admin"])).json();
    expect(res.data).toHaveLength(30);
    const open = res.data.find((r: { id: string }) => r.id === nonConfidentialOpenId);
    expect(open).toMatchObject({ confidential: false, summary: null });
    expect(res.data.every((r: { summary: unknown }) => r.summary === null)).toBe(true);
    expect(JSON.stringify(res)).not.toContain(SUMMARY);
    expect(res.data.every((r: { id: string }) => OPEN_TO_HR_ADMIN_IDS.has(r.id))).toBe(true);
  });

  it("super_admin is treated like hr_admin: no summary", async () => {
    const res = (await get("?limit=200", randomUUID(), ["super_admin"])).json();
    expect(res.data.every((r: { summary: unknown }) => r.summary === null)).toBe(true);
  });

  it("an icc_member still reads the summary", async () => {
    const res = (await get("?limit=5")).json();
    expect(res.data.every((r: { summary: string }) => r.summary === SUMMARY)).toBe(true);
  });

  it("no identity or internal column ever leaves the list", async () => {
    const res = (await get("?limit=200")).json();
    for (const row of res.data as Array<Record<string, unknown>>) {
      expect(Object.keys(row).sort()).toEqual(["caseNo", "confidential", "filedAt", "id", "status", "summary"]);
    }
  });

  it("is still ICC-gated (403 for other roles)", async () => {
    expect((await get("", randomUUID(), ["employee"])).statusCode).toBe(403);
    expect((await get("", randomUUID(), ["hr_officer"])).statusCode).toBe(403);
  });
});
