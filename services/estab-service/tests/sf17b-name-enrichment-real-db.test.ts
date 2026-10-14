/**
 * GAP-ESTAB-SF-17b: quarter-allotment (and other estab) lists resolve the person's
 * name with one batched, tenant-scoped hrms lookup of exactly the ids on the page,
 * for employee ids AND identity-provider actor ids (officers routed to are
 * employee ids; authors and creators are actor ids). They used to read the whole
 * directory, which hrms caps at 2000 rows, so anyone past the cap was nameless and
 * the web rendered `employeeRef.slice(0, 8)`.
 *
 * Real estab Postgres (estab_svc, FORCE RLS). hrms is faked only at its HTTP
 * boundary: a tenant-aware stand-in for /v1/hrms/internal/employee-summaries that
 * enforces the 2000-row cap on the unfiltered feed like the real route.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { runWithTenant, withRawTenantGuc } from "@civitasone/db";

const PORT = 53918;
vi.hoisted(() => {
  process.env.HRMS_SERVICE_URL = "http://127.0.0.1:53918";
  process.env.INTERNAL_SERVICE_SECRET = "sf17b-test-internal-secret";
});

import { sqlClient } from "../src/shared/db.js";
import { listAllotments, getAllotment } from "../src/modules/quarters/queries.js";
import { getEmployeeDisplayMap } from "../src/shared/hrms-client.js";

const TENANT = "beef0000-0000-4000-8000-00000017b101";
const OTHER = "beef0000-0000-4000-8000-00000017b102";
const ACTOR = "beef0000-0000-4000-8000-00000017b1a0";
const QUARTER = "beef0000-0000-4000-8000-00000017b1c0";
const FOREIGN_EMP = "beef0000-0000-4000-8000-00000017b1e0";
const N = 2100;
const empId = (i: number) => `beef0000-0000-4000-9000-${String(i).padStart(12, "0")}`;
const loginOf = (i: number) => `beef0000-0000-4000-a000-${String(i).padStart(12, "0")}`;
const nameOf = (i: number) => `Sf17b Person ${String(i).padStart(4, "0")}`;

type Emp = { id: string; fullName: string; employeeNo: string; userRef: string | null };
const hrmsData: Record<string, Emp[]> = {
  [TENANT]: Array.from({ length: N }, (_, k) => ({ id: empId(k + 1), fullName: nameOf(k + 1), employeeNo: `S17B-${k + 1}`, userRef: loginOf(k + 1) })),
  [OTHER]: [{ id: FOREIGN_EMP, fullName: "Foreign Tenant Person", employeeNo: "S17B-F", userRef: loginOf(9999) }],
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
    const actorIds = url.searchParams.get("actorIds");
    if (ids) { const s = new Set(ids.split(",")); rows = rows.filter((r) => s.has(r.id)).slice(0, 50); }
    if (actorIds) { const s = new Set(actorIds.split(",")); rows = rows.filter((r) => r.userRef && s.has(r.userRef)).slice(0, 50); }
    rows = rows.slice(0, 2000);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(rows.map((r) => ({ ...r, departmentName: "Estate" }))));
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
}

/** The request-scoped tenant context the HTTP layer establishes (FORCE RLS reads need it). */
const inTenant = <T,>(t: string, fn: () => Promise<T>): Promise<T> => runWithTenant(t, fn);
const asT = <T,>(t: string, fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, t, fn);
async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await asT(t, (tx) => tx`DELETE FROM quarters.estab_quarter_allotments WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM quarters.estab_quarters WHERE tenant_id = ${t}`);
  }
}

beforeAll(async () => {
  await startFakeHrms();
  await cleanup();
  await asT(TENANT, async (tx) => {
    await tx`INSERT INTO quarters.estab_quarters (id, tenant_id, quarter_no, created_by, updated_by) VALUES (${QUARTER}, ${TENANT}, 'B-14', ${ACTOR}, ${ACTOR})`;
    // allotments by employee id for employees 1..N, plus one that points at another tenant's employee
    await tx`
      INSERT INTO quarters.estab_quarter_allotments (tenant_id, quarter_id, employee_ref, created_by, updated_by)
      SELECT ${TENANT}, ${QUARTER}, ('beef0000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, ${ACTOR}, ${ACTOR}
        FROM generate_series(1, ${N}) g`;
    await tx`
      INSERT INTO quarters.estab_quarter_allotments (tenant_id, quarter_id, employee_ref, created_by, updated_by)
      VALUES (${TENANT}, ${QUARTER}, ${FOREIGN_EMP}, ${ACTOR}, ${ACTOR})`;
  });
}, 120_000);

afterAll(async () => {
  await cleanup();
  await new Promise<void>((r) => server.close(() => r()));
  await sqlClient.end();
});

describe("SF-17b estab name enrichment (real DB, tenant-aware hrms boundary)", () => {
  it("every allotment on the page is named, including employees past hrms's 2000-row cap", async () => {
    requests.length = 0;
    const { rows, total } = await inTenant(TENANT, () => listAllotments(TENANT, { limit: 5000, offset: 0 }));
    expect(total).toBe(N + 1);
    const byRef = new Map(rows.map((r) => [r.employeeRef, r.employeeName]));
    expect(byRef.get(empId(1))).toBe(nameOf(1));
    expect(byRef.get(empId(N))).toBe(nameOf(N));
    expect(rows.filter((r) => r.employeeRef !== FOREIGN_EMP && !r.employeeName)).toHaveLength(0);
    expect(requests.every((r) => r.includes("ids=") || r.includes("actorIds="))).toBe(true);
  });

  it("cross-tenant: another tenant's employee is unresolved (null) and their name never appears", async () => {
    const { rows } = await inTenant(TENANT, () => listAllotments(TENANT, { limit: 5000, offset: 0 }));
    expect(rows.find((r) => r.employeeRef === FOREIGN_EMP)?.employeeName).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("Foreign Tenant Person");
  });

  it("the single-allotment read is enriched the same way", async () => {
    const { rows } = await inTenant(TENANT, () => listAllotments(TENANT, { limit: 5000, offset: 0 }));
    const last = rows.find((r) => r.employeeRef === empId(N))!;
    const one = await inTenant(TENANT, () => getAllotment(TENANT, last.id));
    expect(one?.employeeName).toBe(nameOf(N));
    expect(one?.quarterNo).toBe("B-14");
  });

  it("resolves identity-provider actor ids (creators/authors), not just employee ids", async () => {
    const map = await getEmployeeDisplayMap(TENANT, [loginOf(2050), empId(7)]);
    expect(map.get(loginOf(2050))?.fullName).toBe(nameOf(2050));
    expect(map.get(empId(7))?.fullName).toBe(nameOf(7));
  });

  it("cross-tenant actor ids stay unresolved", async () => {
    const map = await getEmployeeDisplayMap(TENANT, [loginOf(9999), "not-a-uuid"]);
    expect(map.size).toBe(0);
  });

  it("an empty id list makes no hrms request", async () => {
    requests.length = 0;
    expect((await getEmployeeDisplayMap(TENANT, [])).size).toBe(0);
    expect(requests).toEqual([]);
  });
});
