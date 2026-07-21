import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

const log = pino({ name: "project-rag-scheduler" });

export type Rag = "green" | "amber" | "red";

export type RagInputs = {
  /** today as YYYY-MM-DD */
  today: string;
  /** planned dates (YYYY-MM-DD) of milestones not yet completed */
  openMilestonePlannedDates: string[];
  /** latest cumulative physical % (0-100) */
  physicalPct: number;
  /** financial % (expenditure / sanction * 100) */
  financialPct: number;
  /** project planned end date (YYYY-MM-DD) or null */
  endDate: string | null;
};

export type RagResult = { rag: Rag; delayed: boolean };

/**
 * P0-2 / P0-4: deterministic RAG + slippage computation.
 * RED (delayed) when any milestone is overdue, the project end date has passed while
 * incomplete, or financial spend materially outruns physical progress (>25pp).
 * AMBER on a softer financial/physical variance (>10pp). GREEN otherwise.
 */
export function computeRag(input: RagInputs): RagResult {
  const overdueMilestone = input.openMilestonePlannedDates.some((d) => d < input.today);
  const endOverdue = input.endDate !== null && input.endDate < input.today && input.physicalPct < 100;
  const variance = input.financialPct - input.physicalPct;

  if (overdueMilestone || endOverdue || variance > 25) {
    return { rag: "red", delayed: true };
  }
  if (variance > 10) {
    return { rag: "amber", delayed: false };
  }
  return { rag: "green", delayed: false };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * One scheduler tick: recompute RAG for active projects and persist rag + delayed status.
 * A project flipped to delayed keeps status 'delayed' (an extension of 'active' in the dashboard);
 * recovering projects revert to 'active'.
 */
export async function runRagTick(limit = 1000): Promise<{ scanned: number; flipped: number }> {
  const today = todayIso();
  const projects = await repo.listActiveProjects(limit);
  let flipped = 0;

  for (const project of projects) {
    const milestones = await repo.listMilestonesByProject(project.id, project.tenantId);
    const openPlanned = milestones
      .filter((m) => m.status !== "completed" && m.status !== "cancelled")
      .map((m) => m.plannedDate.toString());

    const { rag, delayed } = computeRag({
      today,
      openMilestonePlannedDates: openPlanned,
      physicalPct: Number(project.physicalPct),
      financialPct: Number(project.financialPct),
      endDate: project.endDate ? project.endDate.toString() : null,
    });

    const nextStatus = delayed ? "delayed" : "active";
    if (project.rag !== rag || project.status !== nextStatus) {
      // RLS fix: listActiveProjects() polls across ALL tenants (intentional,
      // see repo.ts), but this per-project write IS tenant-scoped and must run
      // with that tenant's GUC set. db.transaction() only picks up
      // app.tenant_id from AsyncLocalStorage (wrapWithTenantGuc), so establish
      // the tenant context for this project via runWithTenant() first.
      await runWithTenant(project.tenantId, async () => {
        await db.transaction(async (tx) => {
          await repo.updateProjectRagStatusTx(tx, project.id, { rag, status: nextStatus });
          // also flip any overdue, still-open milestones to 'delayed' so the detail view reflects slippage
          for (const m of milestones) {
            if (m.status !== "completed" && m.status !== "cancelled"
              && m.plannedDate.toString() < today && m.status !== "delayed") {
              await repo.updateMilestoneTx(tx, m.id, { status: "delayed" });
            }
          }
        });
      });
      await cache.invalidate(cache.makeKey(project.tenantId, "project", project.id));
      flipped += 1;
    }
  }

  log.info({ scanned: projects.length, flipped }, "rag tick complete");
  return { scanned: projects.length, flipped };
}

export function startRagScheduler(intervalMs = Number(process.env.RAG_TICK_INTERVAL_MS ?? 60000)): NodeJS.Timeout {
  // run once shortly after boot, then on the interval
  setTimeout(() => { void runRagTick().catch((err) => log.error({ err }, "rag tick failed")); }, 5000);
  return setInterval(() => {
    void runRagTick().catch((err) => log.error({ err }, "rag tick failed"));
  }, intervalMs);
}
