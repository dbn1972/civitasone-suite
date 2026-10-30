import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { definitions } from "../definitions/schema.js";
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
export async function seedDefinitionsTx(
  tx: defRepo.Writer,
  tenantId: string,
  actorId: string,
  defs: SeedDefinition[],
): Promise<SeedPlan> {
  const plan = await planSeedTx(tx, tenantId, defs);
  for (const def of defs) {
    if (!plan.missing.includes(def.code)) continue;
    const definitionId = randomUUID();
    await tx.insert(definitions).values({
      id: definitionId,
      tenantId,
      code: def.code,
      name: def.name,
      version: 1,
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
  }
  return plan;
}
