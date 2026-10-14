/**
 * GAP-HR-SF-17b: payroll list/detail endpoints resolve person names with one
 * batched, tenant-scoped lookup of exactly the ids on the page. They used to ask
 * hrms for the whole directory, which hrms caps at 2000 rows, so any employee
 * past the cap lost their name (and the web then showed an id fragment).
 *
 * Real payroll Postgres (FORCE RLS, payroll_svc). hrms is the only thing faked,
 * and only at its HTTP boundary: a tenant-aware stand-in for
 * /v1/hrms/internal/employee-summaries that also enforces the 2000-row cap on the
 * unfiltered feed, exactly like the real route. Needs DATABASE_URL on a migrated
 * payroll DB (your own disposable instance, see vitest.config.ts REL-035).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { runWithTenant, withRawTenantGuc } from "@civitasone/db";

const PORT = 53917;
vi.hoisted(() => {
  process.env.HRMS_SERVICE_URL = "http://127.0.0.1:53917";
  process.env.INTERNAL_SERVICE_SECRET = "sf17b-test-internal-secret";
});

import { sqlClient } from "../src/shared/db.js";
import { listPfReport, listGpfReport } from "../src/modules/statutory/queries.js";
import { fetchEmployeeSummaries } from "../src/shared/hrms-client.js";

const TENANT = "beef0000-0000-4000-8000-00000017b001";
const OTHER = "beef0000-0000-4000-8000-00000017b002";
const ACTOR = "beef0000-0000-4000-8000-00000017b0a0";
const FOREIGN_EMP = "beef0000-0000-4000-8000-00000017b0e0";
const N = 2100; // more than hrms's 2000-row cap
const empId = (i: number) => `beef0000-0000-4000-9000-${String(i).padStart(12, "0")}`;
const nameOf = (i: number) => `Sf17b Person ${String(i).padStart(4, "0")}`;

type Emp = { id: string; fullName: string; employeeNo: string };
const hrmsData: Record<string, Emp[]> = {
  [TENANT]: Array.from({ length: N }, (_, k) => ({ id: empId(k + 1), fullName: nameOf(k + 1), employeeNo: `S17B-${k + 1}` })),
  [OTHER]: [{ id: FOREIGN_EMP, fullName: "Foreign Tenant Person", employeeNo: "S17B-F" }],
};
const requests: string[] = [];
let server: Server;

function startFakeHrms(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    requests.push(url.pathname + url.search);
    const tenant = String(req.headers["x-tenant-id"] ?? "");
    if (req.headers["x-internal"] !== "1" || req.headers["x-service-secret"] !== process.env.INTERNAL_SERVICE_SECRET) {
      res.statusCode = 401; res.end("{}"); return;
    }
    let rows = [...(hrmsData[tenant] ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));
    const ids = url.searchParams.get("ids");
    if (ids) { const set = new Set(ids.split(",")); rows = rows.filter((r) => set.has(r.id)).slice(0, 50); }
    rows = rows.slice(0, 2000);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(rows.map((r) => ({ ...r, departmentName: "Revenue", userRef: null }))));
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
}

/** The request-scoped tenant context the HTTP layer establishes (FORCE RLS reads need it). */
const inTenant = <T,>(t: string, fn: () => Promise<T>): Promise<T> => runWithTenant(t, fn);
const asT = <T,>(t: string, fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, t, fn);

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await asT(t, (tx) => tx`DELETE FROM statutory.payroll_pf WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM statutory.payroll_gpf WHERE tenant_id = ${t}`);
  }
}

beforeAll(async () => {
  await startFakeHrms();
  await cleanup();
  await asT(TENANT, async (tx) => {
    await tx`
      INSERT INTO statutory.payroll_pf (tenant_id, slip_id, employee_id, run_id, period, created_by, updated_by)
      SELECT ${TENANT}, gen_random_uuid(), ('beef0000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, gen_random_uuid(), '2026-08', ${ACTOR}, ${ACTOR}
        FROM generate_series(1, ${N}) g`;
    // a row whose employee exists only in ANOTHER tenant's directory
    await tx`
      INSERT INTO statutory.payroll_pf (tenant_id, slip_id, employee_id, run_id, period, created_by, updated_by)
      VALUES (${TENANT}, gen_random_uuid(), ${FOREIGN_EMP}, gen_random_uuid(), '2026-08', ${ACTOR}, ${ACTOR})`;
  });
}, 120_000);

afterAll(async () => {
  await cleanup();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("SF-17b payroll name enrichment (real DB, tenant-aware hrms boundary)", () => {
  it("the unfiltered hrms feed really is capped (the bug this fixes)", async () => {
    const all = await fetchEmployeeSummaries(TENANT);
    expect(all.size).toBe(2000);
    expect(all.has(empId(N))).toBe(false);
  });

  it("PF ledger: every employee past the 2000-row cap still has their name", async () => {
    requests.length = 0;
    const rows = await inTenant(TENANT, () => listPfReport(TENANT, 5000));
    expect(rows).toHaveLength(N + 1);
    const byId = new Map(rows.map((r) => [r.employeeId, r.employeeName]));
    expect(byId.get(empId(1))).toBe(nameOf(1));
    expect(byId.get(empId(2000))).toBe(nameOf(2000));
    expect(byId.get(empId(N))).toBe(nameOf(N));
    expect(rows.filter((r) => r.employeeId !== FOREIGN_EMP && !r.employeeName)).toHaveLength(0);
    // exactly the page's ids were requested, in batches, never the whole directory
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every((r) => r.includes("ids="))).toBe(true);
  });

  it("cross-tenant: an id that belongs to another tenant resolves to null, and its name never appears", async () => {
    const rows = await inTenant(TENANT, () => listPfReport(TENANT, 5000));
    const foreign = rows.find((r) => r.employeeId === FOREIGN_EMP);
    expect(foreign?.employeeName).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("Foreign Tenant Person");
  });

  it("an empty page makes no hrms request", async () => {
    requests.length = 0;
    const rows = await inTenant(OTHER, () => listPfReport(OTHER, 10));
    expect(rows).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("GPF ledger accepts the same ids lookup (no rows, no throw)", async () => {
    await expect(inTenant(OTHER, () => listGpfReport(OTHER, 10))).resolves.toEqual([]);
  });
});
