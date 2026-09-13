import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { SchemeRow } from "./schema.js";

function minorToAmount(minor: bigint): number {
  return Number(minor) / 100;
}

function toDateOnly(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return new Date(value as string).toISOString().slice(0, 10);
}

function mapFundingType(type: string): "central" | "state" | "centrally_sponsored" | "external" {
  if (type === "state") return "state";
  if (type === "external") return "external";
  if (type === "css") return "centrally_sponsored";
  return "central";
}

export async function getScheme(id: string, tenantId: string): Promise<SchemeRow | null> {
  return cache.getOrLoad<SchemeRow>(
    cache.makeKey(tenantId, "scheme", id),
    () => repo.findSchemeById(id, tenantId)
  );
}

export type SchemeDetailProject = {
  id: string;
  code: string;
  name: string;
  status: string;
  budgetMinor: string;
};

export type SchemeDetail = {
  id: string;
  schemeCode: string;
  name: string;
  fundingType: "central" | "state" | "centrally_sponsored" | "external";
  fundingPattern: string;
  sanctionRef?: string;
  totalOutlayMinor: string;
  releasedMinor: string;
  utilisedMinor: string;
  utilisationPct: number;
  status: "active" | "completed" | "discontinued";
  projects: SchemeDetailProject[];
};

/**
 * COMP-016: backs GET /v1/projects/schemes/:id for real. getScheme() above
 * already round-trips fundingPattern correctly (repo.findSchemeById does a
 * bare `select()` — all columns, Drizzle default — and this passes the row
 * through unchanged), and routes.ts used to `reply.send()` that raw
 * SchemeRow directly. Verified empirically (not just read) that this does
 * NOT crash on the BigInt totalOutlayMinor/releasedMinor/utilisedMinor
 * fields: @civitasone/observability's registerOpsRoutes wires a global
 * `preSerialization` hook (jsonSafe(), packages/observability/src/index.ts)
 * that stringifies BigInt everywhere in every response, service-wide — a
 * different mechanism from finance/revenue/workflow/works-service's
 * per-service BigInt.prototype.toJSON shims, but one project-service already
 * has too. (An early draft of this fix assumed no such safety net existed
 * here and that the raw route 500s on a real row; a bare `new Fastify()`
 * with none of buildApp()'s plugins registered does throw "Do not know how
 * to serialize a BigInt", which is what misled that assumption — but
 * app.inject() against the real buildApp() returns 200 with
 * already-stringified minor-unit fields. Corrected after curling it for
 * real; see the sabotage-check note on the test file.)
 *
 * The actual, verified gap is a shape mismatch, not a crash: the raw row has
 * `code`, not `schemeCode`, no `projects` sub-list, no `utilisationPct`, no
 * `fundingType`, and leaks internal columns (tenantId/createdAt/updatedAt/
 * createdBy/updatedBy/version) no frontend consumer needs. This function
 * builds the real DTO instead: real project sub-list via the new
 * repo.listProjectsByScheme, a computed utilisationPct, and stringified
 * (not minorToAmount()'d) money fields. Deliberately NOT minorToAmount():
 * that helper returns whole RUPEES, and the schemes LIST page's
 * SchemesTable.tsx already feeds that rupee number straight into
 * formatMoney() (which treats a bare number as PAISE) -- under-displaying
 * every allocation/released amount by 100x. Minor-unit strings sidestep that
 * bug and match the convention grant-service's working grants/schemes/[id]
 * page already relies on (formatMoney(scheme.budgetMinor) called directly on
 * a "Minor"-suffixed field).
 *
 * nodalOfficer, department and beneficiaries are deliberately absent from
 * this DTO: no column for any of the three exists anywhere in
 * project-service's schema (verified directly against scheme/schema.ts and
 * project/schema.ts, not just asserted) -- see the COMP-016 row in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md for the still-open product/schema
 * decision on those three. Same story for the scheme's own start/end dates
 * (also shown by the old hardcoded page, also no backing column) -- the
 * frontend renders all of these as an honest "--", never invented values.
 */
export async function getSchemeDetail(id: string, tenantId: string): Promise<SchemeDetail | null> {
  const row = await getScheme(id, tenantId);
  if (!row) return null;

  const projectRows = await repo.listProjectsByScheme(id, tenantId);
  const totalOutlay = row.totalOutlayMinor ?? 0n;
  const utilised = row.utilisedMinor ?? 0n;
  // Percentage-only: Number() on paise amounts well within Number.MAX_SAFE_INTEGER
  // (even ₹10,000 Cr is 10^13 paise) is exact, unlike formatMoney's currency
  // path this deliberately avoids Number() for.
  const utilisationPct = totalOutlay > 0n
    ? Math.round((Number(utilised) / Number(totalOutlay)) * 1000) / 10
    : 0;

  return {
    id: row.id,
    schemeCode: row.code,
    name: row.name,
    fundingType: mapFundingType(row.type),
    fundingPattern: row.fundingPattern,
    // exactOptionalPropertyTypes: omit the key entirely on no value, rather
    // than setting it to `undefined` -- SchemeDetail.sanctionRef is
    // `?: string`, which under this tsconfig means "absent or string", not
    // "string | undefined".
    ...(row.sanctionRef ? { sanctionRef: row.sanctionRef } : {}),
    totalOutlayMinor: totalOutlay.toString(),
    releasedMinor: (row.releasedMinor ?? 0n).toString(),
    utilisedMinor: utilised.toString(),
    utilisationPct,
    status: (row.status === "completed" ? "completed" : row.status === "discontinued" ? "discontinued" : "active") as "active" | "completed" | "discontinued",
    projects: projectRows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      budgetMinor: (p.dprCostMinor ?? 0n).toString(),
    })),
  };
}

/**
 * PERF-019: was N+1 — one countProjectsByScheme COUNT query PER scheme row.
 * Now: the outer list (possibly cache-served) plus exactly 1 grouped-count
 * query total regardless of row count. Response shape and per-row field
 * mapping are unchanged from the original loop.
 */
export async function listSchemeSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "schemes", `list:${limit}`),
    () => repo.listSchemesByTenant(tenantId, limit),
  );
  const list = rows ?? [];

  const schemeIds = list.map((row) => row.id);
  const projectCountBySchemeId = await repo.countProjectsBySchemeIds(schemeIds, tenantId);

  return list.map((row) => ({
    id: row.id,
    schemeCode: row.code,
    name: row.name,
    fundingType: mapFundingType(row.type),
    totalAllocation: minorToAmount(row.totalOutlayMinor),
    releasedAmount: minorToAmount(row.releasedMinor),
    projectCount: projectCountBySchemeId.get(row.id) ?? 0,
    status: (row.status === "completed" ? "completed" : row.status === "discontinued" ? "discontinued" : "active") as "active" | "completed" | "discontinued",
  }));
}

export async function listFundReleaseSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "fund_releases", `list:${limit}`),
    () => repo.listFundReleasesByTenant(tenantId, limit),
  );
  const summaries = [];
  for (const row of rows ?? []) {
    const scheme = await repo.findSchemeById(row.schemeId, tenantId);
    summaries.push({
      id: row.id,
      releaseNo: row.releaseNo,
      projectId: row.schemeId,
      projectName: scheme?.name ?? row.schemeId,
      amount: minorToAmount(row.amountMinor),
      releaseDate: toDateOnly(row.disbursedAt ?? row.createdAt),
      releasedBy: row.sanctionedBy ?? undefined,
      status: (row.status === "disbursed" ? "released" : row.status === "utilised" ? "utilized" : "sanctioned") as "sanctioned" | "released" | "utilized",
    });
  }
  return summaries;
}
