import { pino } from "pino";
import { cache } from "../../shared/infra.js";
import * as employeeRepo from "../employee/repo.js";
import { batchDepartments, batchDesignations } from "../../shared/batch-resolve.js";

const log = pino({ name: "orgchart-queries" });

type OrgNode = {
  id: string;
  name: string;
  designation: string;
  department: string;
  reportsTo?: string | null;
  children?: OrgNode[];
};

function buildSubtree(
  empId: string,
  active: Awaited<ReturnType<typeof employeeRepo.listByTenant>>,
  activeIds: Set<string>,
  designationNames: Map<string, string>,
  departmentNames: Map<string, string>,
): OrgNode {
  const emp = active.find((e) => e.id === empId)!;
  return {
    id: emp.id,
    name: emp.fullName,
    // GAP-HR-ORG-CHART-01: designationId/departmentId are internal ids, not
    // display text -- every node chip used to show a raw id fragment
    // (emp.designationId.slice(0, 8)) instead of a real title, and search
    // matched on those fragments too. Resolve real names via the shared
    // batch-resolve helpers (built once per call in getOrgChart below).
    designation: designationNames.get(emp.designationId) ?? "—",
    department: departmentNames.get(emp.departmentId) ?? "—",
    // GAP-HR-ORG-CHART-05: an employee whose manager has separated still
    // carries that (no-longer-active) managerId. Returning it here made the
    // node look like it reports to someone, so the client's `!reportsTo`
    // root filter silently dropped the whole subtree instead of surfacing
    // it as a root. Null it out once the manager is no longer in the active
    // set, same set `roots` below already uses to decide who counts as a
    // root at the query level.
    reportsTo: emp.managerId && activeIds.has(emp.managerId) ? emp.managerId : null,
    children: active
      .filter((e) => e.managerId === empId)
      .map((e) => buildSubtree(e.id, active, activeIds, designationNames, departmentNames)),
  };
}

/** Rows fetched per keyset page. */
const PAGE_SIZE = 2000;
/**
 * Hard safety ceiling (PAGE_SIZE x MAX_PAGES = 50,000 employees) so a
 * runaway tenant cannot make one request read unbounded rows. Far above any
 * real single-tenant government org; hitting it is logged, never silent.
 */
const MAX_PAGES = 25;

/**
 * GAP-HR-ORG-CHART-05: previously a single `listByTenant(tenantId, 2000, 0)`
 * slice -- any tenant with more than 2000 employees silently lost everyone
 * past the first 2000 (and, worse, their managers' subtrees). Pages through
 * the whole tenant instead.
 */
async function loadAllEmployees(tenantId: string): Promise<Awaited<ReturnType<typeof employeeRepo.listPageAfterId>>> {
  const all: Awaited<ReturnType<typeof employeeRepo.listPageAfterId>> = [];
  let afterId: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await employeeRepo.listPageAfterId(tenantId, afterId, PAGE_SIZE);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) return all;
    afterId = batch[batch.length - 1]!.id;
  }
  log.warn({ tenantId, rows: all.length }, "org chart truncated at the MAX_PAGES safety ceiling");
  return all;
}

export async function getOrgChart(tenantId: string): Promise<OrgNode[]> {
  return cache.listOrLoad(tenantId, "org_chart", "tree", async () => {
    const rows = await loadAllEmployees(tenantId);
    const active = rows.filter((e) => e.status !== "separated");
    const idSet = new Set(active.map((e) => e.id));
    const [designationNames, departmentNames] = await Promise.all([
      batchDesignations(tenantId, active.map((e) => e.designationId)),
      batchDepartments(tenantId, active.map((e) => e.departmentId)),
    ]);
    const roots = active.filter((e) => !e.managerId || !idSet.has(e.managerId));
    return roots.map((e) => buildSubtree(e.id, active, idSet, designationNames, departmentNames));
  }) as Promise<OrgNode[]>;
}
