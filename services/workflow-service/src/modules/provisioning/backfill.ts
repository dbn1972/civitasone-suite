/**
 * F77: one-off backfill of the standard workflow definitions for tenants that
 * were provisioned before a code joined the catalogue (e.g. the procurement
 * PO / indent approval chains), or that never went through tenant.created at
 * all. CLI wrapper: src/scripts/backfill-standard-definitions.ts (see its
 * header for how to run).
 *
 * Idempotent: it seeds only codes with no row for the tenant (seed.ts), so a
 * re-run, or a run after the tenant.created consumer, changes nothing.
 */
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { definitionsForClusters, seedClustersFromEnv, STANDARD_DEFINITIONS, type SeedDefinition } from "./catalog.js";
import { planSeedTx, planRepairTx, repairBrokenDefinitionsTx, seedDefinitionsTx, type SeedPlan, type RepairPlan, type Repaired } from "./seed.js";

export type BackfillResult = SeedPlan & { seeded: string[] };

/**
 * The catalogue entries to backfill: the deployment's enabled clusters (the
 * same set tenant.created seeds), optionally narrowed to `codes`. An unknown
 * code is an operator typo and fails loudly rather than silently doing nothing.
 */
export function selectDefinitions(codes?: string[], clustersRaw?: string): SeedDefinition[] {
  const enabled = definitionsForClusters(seedClustersFromEnv(clustersRaw));
  if (!codes || codes.length === 0) return enabled;
  const unknown = codes.filter((c) => !STANDARD_DEFINITIONS.some((d) => d.code === c));
  if (unknown.length) throw new Error(`not a standard catalogue code: ${unknown.join(", ")}`);
  const disabled = codes.filter((c) => !enabled.some((d) => d.code === c));
  if (disabled.length) throw new Error(`code's cluster is not enabled by WORKFLOW_SEED_CLUSTERS: ${disabled.join(", ")}`);
  return enabled.filter((d) => codes.includes(d.code));
}

export async function backfillStandardDefinitions(
  tenantId: string,
  opts: { actorId: string; dryRun?: boolean; defs: SeedDefinition[] },
): Promise<BackfillResult> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    if (opts.dryRun) {
      const plan = await planSeedTx(tx, tenantId, opts.defs);
      return { ...plan, seeded: [] };
    }
    const plan = await seedDefinitionsTx(tx, tenantId, opts.actorId, opts.defs);
    if (plan.missing.length > 0) {
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId, actorId: opts.actorId, correlationId: randomUUID(),
        payload: {
          service: "workflow", action: "backfill_definitions", resourceType: "workflow_definition",
          resourceId: tenantId, outcome: "success", metadata: { codes: plan.missing },
        },
      });
    }
    return { ...plan, seeded: plan.missing };
  }));
}

export type RepairResult = RepairPlan & { repaired: Repaired[] };

/**
 * B10 `--repair-broken`: replace known-broken catalogue chains (see
 * catalog.ts brokenRoleRefs) that have no in-flight instances. One
 * audit.event.record per replacement; definitions with in-flight instances
 * are skipped and reported. Dry run reports the plan and writes nothing.
 */
export async function repairBrokenStandardDefinitions(
  tenantId: string,
  opts: { actorId: string; dryRun?: boolean; defs: SeedDefinition[] },
): Promise<RepairResult> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    if (opts.dryRun) {
      const plan = await planRepairTx(tx, tenantId, opts.defs);
      return { ...plan, repaired: [] };
    }
    const r = await repairBrokenDefinitionsTx(tx, tenantId, opts.actorId, opts.defs);
    for (const x of r.repaired) {
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId, actorId: opts.actorId, correlationId: randomUUID(),
        payload: {
          service: "workflow", action: "repair_definition", resourceType: "workflow_definition",
          resourceId: x.newDefinitionId, outcome: "success",
          metadata: {
            code: x.code, replacedDefinitionId: x.definitionId, replacedVersion: x.version,
            newVersion: x.newVersion, brokenRoleRefs: x.brokenRoleRefs,
          },
        },
      });
    }
    return r;
  }));
}
