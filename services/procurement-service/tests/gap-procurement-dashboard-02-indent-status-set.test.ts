/**
 * GAP-PROCUREMENT-DASHBOARD-02: the dashboard's "Pending Indents" counter counts
 * indents whose status is draft OR pending, so its drill-through must page over
 * exactly those rows. The list route therefore accepts a comma-separated
 * `?status=` set and applies it in SQL (IN), so limit/offset count matching
 * rows only: a tenant whose draft/pending indents are all past the first
 * unfiltered page still lands on them, never on an empty list.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementIndents } from "../src/modules/indent/schema.js";
import * as queries from "../src/modules/indent/queries.js";
import { parseStatusFilter } from "../src/modules/indent/repo.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "d02d0200-1111-4000-8000-000000000001";
const OTHER_TENANT = "d02d0200-1111-4000-8000-000000000002";
const ACTOR = "d02d0200-2222-4000-8000-000000000001";
const DEPT_A = "Roads and Buildings";
const DEPT_B = "Health";

const id = (n: number) => `d02d0200-3333-4000-8000-${String(n).padStart(12, "0")}`;

// Indent numbers sort in the order listed (the list orders by indent number).
// Statuses are interleaved so the matching rows (draft/pending) sit past the
// first two unfiltered rows.
const FIXTURE = [
  { n: 1, indentNo: "IND-D02-01", status: "approved", dept: DEPT_A },
  { n: 2, indentNo: "IND-D02-02", status: "tender_required", dept: DEPT_A },
  { n: 3, indentNo: "IND-D02-03", status: "draft", dept: DEPT_A },
  { n: 4, indentNo: "IND-D02-04", status: "rejected", dept: DEPT_B },
  { n: 5, indentNo: "IND-D02-05", status: "pending", dept: DEPT_B },
  { n: 6, indentNo: "IND-D02-06", status: "closed", dept: DEPT_A },
  { n: 7, indentNo: "IND-D02-07", status: "draft", dept: DEPT_B },
  { n: 8, indentNo: "IND-D02-08", status: "pending", dept: DEPT_A },
] as const;
const MATCHING = FIXTURE.filter((f) => f.status === "draft" || f.status === "pending").map((f) => id(f.n));

const token = () => signToken({ sub: ACTOR, tid: TENANT, roles: ["procurement_officer"], sid: "s-d02" }, SECRET, 3600);

let app: FastifyInstance;

async function insert(tenantId: string, rowId: string, indentNo: string, status: string, department: string) {
  await runWithTenant(tenantId, () => db.transaction((tx) => tx.insert(procurementIndents).values({
    id: rowId, tenantId, indentNo, department, purpose: "Dashboard drill-through fixture",
    totalMinor: 100000n, committedMinor: 0n, currency: "INR", status, indentDate: "2026-09-01",
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
}

async function wipe() {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(procurementIndents).where(eq(procurementIndents.tenantId, t))));
  }
}

async function list(query: string): Promise<Array<{ id: string }>> {
  const res = await app.inject({
    method: "GET",
    url: `/v1/procurement/indents?${query}`,
    headers: { authorization: `Bearer ${token()}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Array<{ id: string }>;
}

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  for (const f of FIXTURE) await insert(TENANT, id(f.n), f.indentNo, f.status, f.dept);
  // Another tenant's draft indent must never appear in this tenant's drill-through.
  await insert(OTHER_TENANT, id(99), "IND-D02-99", "draft", DEPT_A);
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("parseStatusFilter", () => {
  it("parses one status or a comma-separated set, trimming and de-duplicating", () => {
    expect(parseStatusFilter("pending")).toEqual(["pending"]);
    expect(parseStatusFilter("draft,pending")).toEqual(["draft", "pending"]);
    expect(parseStatusFilter(" draft , ,draft,pending ")).toEqual(["draft", "pending"]);
  });

  it("means no filter when empty and keeps unknown values (they match nothing)", () => {
    expect(parseStatusFilter(undefined)).toEqual([]);
    expect(parseStatusFilter("")).toEqual([]);
    expect(parseStatusFilter(" , ")).toEqual([]);
    expect(parseStatusFilter("bogus")).toEqual(["bogus"]);
  });

  it("caps the set so a hostile query cannot build an unbounded IN list", () => {
    const many = Array.from({ length: 50 }, (_, i) => `s${i}`).join(",");
    expect(parseStatusFilter(many)).toHaveLength(10);
  });
});

describe("GET /v1/procurement/indents?status=a,b — pages over the matching rows only", () => {
  it("returns exactly the draft and pending indents of the tenant, in indent-number order", async () => {
    const rows = await list("status=draft,pending&limit=50&offset=0");
    expect(rows.map((r) => r.id)).toEqual(MATCHING);
    expect(MATCHING).toHaveLength(4);
  });

  it("pages over matching rows: the draft/pending rows past the first unfiltered page are reachable", async () => {
    // Unfiltered, the first two rows are approved and tender_required: a
    // post-filter on that page would find nothing. The SQL filter does not.
    const unfilteredFirstPage = await list("limit=2&offset=0");
    expect(unfilteredFirstPage.map((r) => r.id)).toEqual([id(1), id(2)]);

    const page1 = await list("status=draft,pending&limit=2&offset=0");
    const page2 = await list("status=draft,pending&limit=2&offset=2");
    const page3 = await list("status=draft,pending&limit=2&offset=4");
    expect(page1.map((r) => r.id)).toEqual([id(3), id(5)]);
    expect(page2.map((r) => r.id)).toEqual([id(7), id(8)]);
    expect(page3).toEqual([]);
    expect([...page1, ...page2].map((r) => r.id)).toEqual(MATCHING);
  });

  it("a single status behaves as before, and an unknown status yields an empty list", async () => {
    expect((await list("status=pending&limit=50")).map((r) => r.id)).toEqual([id(5), id(8)]);
    expect(await list("status=no_such_status&limit=50")).toEqual([]);
    expect((await list("status=draft,no_such_status&limit=50")).map((r) => r.id)).toEqual([id(3), id(7)]);
  });

  it("an empty status value means no filter", async () => {
    const rows = await list("status=&limit=50");
    expect(rows).toHaveLength(FIXTURE.length);
  });

  it("combines with the indent-number search", async () => {
    const rows = await list("status=draft,pending&q=IND-D02-0&limit=50");
    expect(rows.map((r) => r.id)).toEqual(MATCHING);
    const narrowed = await list("status=draft,pending&q=IND-D02-07&limit=50");
    expect(narrowed.map((r) => r.id)).toEqual([id(7)]);
  });

  it("never returns another tenant's indent", async () => {
    const rows = await list("status=draft,pending&limit=50");
    expect(rows.map((r) => r.id)).not.toContain(id(99));
  });
});

describe("queries.listIndents with a status set", () => {
  it("applies the set to the department-fenced list too", async () => {
    const rows = await runWithTenant(TENANT, () => queries.listIndents(TENANT, 50, 0, DEPT_B, "draft,pending"));
    expect(rows.map((r) => r.id)).toEqual([id(5), id(7)]);
    expect(rows.every((r) => r.department === DEPT_B)).toBe(true);
  });
});
