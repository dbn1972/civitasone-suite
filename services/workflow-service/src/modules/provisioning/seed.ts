import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { definitions, definitionNodes } from "../definitions/schema.js";
import { instances } from "../instances/schema.js";
import * as defRepo from "../definitions/repo.js";
import { linearEdges, type SeedDefinition } from "./catalog.js";

export type SeedPlan = {
  /** Catalogue codes with no row at all for the tenant: these get seeded. */
  missing: string[];
  /** Codes that already have an ACTIVE definition: left untouched. */
  present: string[];
  /**
   * Codes that only have non-active rows (draft / archived). Left untouched
   * and reported: a tenant admin deliberately drafted or retired that chain,
   * and inserting version 1 would collide with UNIQUE (tenant_id, code,
   * version) anyway.
   */
  inactive: string[];
};

/**
 * F77: classify the catalogue codes for one tenant. Must run inside the
 * tenant's RLS scope (workflow_svc is NOBYPASSRLS).
 */
export async function planSeedTx(
  tx: defRepo.Writer,
  tenantId: string,
  defs: SeedDefinition[],
): Promise<SeedPlan> {
  const plan: SeedPlan = { missing: [], present: [], inactive: [] };
  if (defs.length === 0) return plan;
  const rows = await tx.select({ code: definitions.code, status: definitions.status }).from(definitions)
    .where(and(eq(definitions.tenantId, tenantId), inArray(definitions.code, defs.map((d) => d.code))));
  for (const def of defs) {
    const mine = rows.filter((r) => r.code === def.code);
    if (mine.length === 0) plan.missing.push(def.code);
    else if (mine.some((r) => r.status === "active")) plan.present.push(def.code);
    else plan.inactive.push(def.code);
  }
  return plan;
}

/**
 * Seed every catalogue definition the tenant has no row for (nodes + linear
 * edges). Idempotent: present and inactive codes are skipped, so re-running
 * (re-delivered tenant.created, or the backfill script) never duplicates a
 * definition. Shared by the tenant.created consumer and the F77 backfill so
 * both write exactly the same graph.
 */
async function insertCatalogueVersionTx(
  tx: defRepo.Writer,
  tenantId: string,
  actorId: string,
  def: SeedDefinition,
  version: number,
): Promise<string> {
  const definitionId = randomUUID();
  await tx.insert(definitions).values({
    id: definitionId,
    tenantId,
    code: def.code,
    name: def.name,
    version,
    status: "active",
    createdBy: actorId,
    updatedBy: actorId,
  });
  await defRepo.insertGraphTx(
    tx,
    definitionId,
    def.nodes.map((n, i) => ({
      nodeKey: n.nodeKey,
      name: n.name,
      roleRef: n.roleRef,
      nodeType: "task",
      sortOrder: i + 1,
    })),
    linearEdges(def).map((e, i) => ({ fromNode: e.fromNode, toNode: e.toNode, sortOrder: i + 1 })),
  );
  return definitionId;
}

export async function seedDefinitionsTx(
  tx: defRepo.Writer,
  tenantId: string,
  actorId: string,
  defs: SeedDefinition[],
): Promise<SeedPlan> {
  const plan = await planSeedTx(tx, tenantId, defs);
  for (const def of defs) {
    if (!plan.missing.includes(def.code)) continue;
    await insertCatalogueVersionTx(tx, tenantId, actorId, def, 1);
  }
  return plan;
}

/** Instance statuses that count as in flight for the repair guard. */
export const IN_FLIGHT_STATUSES = ["active", "pending", "suspended"] as const;

export type BrokenDefinition = {
  code: string;
  definitionId: string;
  version: number;
  brokenRoleRefs: string[];
  inFlight: number;
};

export type RepairPlan = {
  /** Broken, no in-flight instances: replaced (or would be, on a dry run). */
  repairable: BrokenDefinition[];
  /** Broken but with in-flight instances: left untouched and reported. */
  skippedInFlight: BrokenDefinition[];
};

/**
 * B10: find ACTIVE tenant definitions of a catalogue code that has a
 * `brokenRoleRefs` list, whose nodes use one of those exact role refs, and
 * count their in-flight instances. Codes without `brokenRoleRefs` are never
 * considered, so a good or tenant-customised chain is never touched.
 */
export async function planRepairTx(
  tx: defRepo.Writer,
  tenantId: string,
  defs: SeedDefinition[],
): Promise<RepairPlan> {
  const plan: RepairPlan = { repairable: [], skippedInFlight: [] };
  for (const def of defs) {
    const broken = def.brokenRoleRefs ?? [];
    if (broken.length === 0) continue;
    const rows = await tx.select({ id: definitions.id, version: definitions.version }).from(definitions)
      .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, def.code), eq(definitions.status, "active")));
    for (const row of rows) {
      const nodeRows = await tx.select({ roleRef: definitionNodes.roleRef }).from(definitionNodes)
        .where(and(eq(definitionNodes.definitionId, row.id), inArray(definitionNodes.roleRef, [...broken])));
      const hits = [...new Set(nodeRows.map((h: { roleRef: string | null }) => h.roleRef!))].sort();
      if (hits.length === 0) continue;
      const running = await tx.select({ id: instances.id }).from(instances)
        .where(and(
          eq(instances.tenantId, tenantId),
          eq(instances.definitionId, row.id),
          inArray(instances.status, [...IN_FLIGHT_STATUSES]),
        ));
      const entry: BrokenDefinition = {
        code: def.code, definitionId: row.id, version: row.version,
        brokenRoleRefs: hits, inFlight: running.length,
      };
      (running.length > 0 ? plan.skippedInFlight : plan.repairable).push(entry);
    }
  }
  return plan;
}

export type Repaired = BrokenDefinition & { newDefinitionId: string; newVersion: number };

/**
 * B10: replace each repairable broken definition with the catalogue graph as a
 * NEW version (latest + 1, active) and archive the broken one. The old row and
 * its nodes are kept (completed/rejected instances and history still point at
 * it). Idempotent: once replaced, the active version has no broken role refs.
 */
export async function repairBrokenDefinitionsTx(
  tx: defRepo.Writer,
  tenantId: string,
  actorId: string,
  defs: SeedDefinition[],
): Promise<RepairPlan & { repaired: Repaired[] }> {
  const plan = await planRepairTx(tx, tenantId, defs);
  const repaired: Repaired[] = [];
  for (const b of plan.repairable) {
    const def = defs.find((d) => d.code === b.code)!;
    const latest = await tx.select({ version: definitions.version }).from(definitions)
      .where(and(eq(definitions.tenantId, tenantId), eq(definitions.code, b.code)))
      .orderBy(desc(definitions.version)).limit(1);
    const newVersion = (latest[0]?.version ?? b.version) + 1;
    await tx.update(definitions)
      .set({ status: "archived", updatedBy: actorId, updatedAt: new Date() })
      .where(and(eq(definitions.tenantId, tenantId), eq(definitions.id, b.definitionId)));
    const newDefinitionId = await insertCatalogueVersionTx(tx, tenantId, actorId, def, newVersion);
    repaired.push({ ...b, newDefinitionId, newVersion });
  }
  return { ...plan, repaired };
}
