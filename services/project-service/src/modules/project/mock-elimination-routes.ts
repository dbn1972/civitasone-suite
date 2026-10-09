/**
 * Read-only query routes for project sub-resources that previously had
 * hardcoded UI data: escalations, beneficiaries, DPR tracking, WBS, delay-analysis.
 *
 * Each endpoint returns the standard list envelope { data: T[], meta: {...} }
 * and falls through to cache → DB. Tenant-scoped by RLS + WHERE.
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { projectProjects, projectTasks } from "../project/schema.js";
import { projectDprs } from "../progress/schema.js";
// GAP-PROJECTS-ESCALATIONS-02: overlay persisted escalation action state onto
// the synthetic projection below. mock-elimination-routes already reaches
// across modules for its read-only projections (see the progress import
// above); this follows the same established pattern (read-only, same tx).
import * as escalationRepo from "../escalation/repo.js";
import { eq, and, desc, sql } from "drizzle-orm";

const READER_ROLES = ["project_officer", "project_admin", "finance_officer", "tenant_admin", "super_admin", "audit_officer"];

function paginationMeta(total: number, page: number, pageSize: number) {
  return { page, pageSize, total };
}

export async function mockEliminationRoutes(app: FastifyInstance): Promise<void> {
  // ─── Escalations ───────────────────────────────────────────────────────────
  app.get("/v1/projects/escalations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const tenantId = ctx.tenantId;

    const rows = await cache.getOrLoad(
      cache.makeKey(tenantId, "project", "escalations"),
      async () => {
        // Escalations are projects with status delayed/on_hold and flagged
        // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
        // before this read — a bare db.select() runs with no RLS GUC set.
        return db.transaction(async (tx) => {
          const result = await tx.select({
            id: projectProjects.id,
            projectCode: projectProjects.code,
            name: projectProjects.name,
            status: projectProjects.status,
            createdAt: projectProjects.createdAt,
          }).from(projectProjects)
            .where(and(
              eq(projectProjects.tenantId, tenantId),
              sql`${projectProjects.status} IN ('delayed', 'on_hold', 'blocked')`,
            ))
            .orderBy(desc(projectProjects.createdAt))
            .limit(200);

          // GAP-PROJECTS-ESCALATIONS-02: overlay the persisted ACTION STATE
          // (acknowledge/reassign/clear) onto the synthetic projection. A
          // project with no persisted escalation row reads as its default
          // projected status; once acted on, the persisted status/assignee win,
          // so an acknowledged/cleared escalation is reflected in the queue and
          // the colour follows (open=bad, acknowledged=warn, cleared=good).
          const persisted = await escalationRepo.listByProjectIdsTx(
            tx, tenantId, result.map((r) => r.id),
          );
          const byProject = new Map(persisted.map((e) => [e.projectId, e]));

          return result.map((r) => {
            const e = byProject.get(r.id);
            const defaultStatus = r.status === "blocked" ? "open" : "submitted";
            // GAP2-PROJECTS-ESCALATIONS-04: do NOT fabricate owner/issue/id.
            // escalationId is the REAL persisted escalation record id (null
            // until the escalation has been acted on); escalatedTo/issue come
            // from the persisted record only. severity is derived from the
            // project's real status (a factual projection, not invented text).
            // No hard-coded "Program Director"/"Critical blocker"/"ESC-NNN".
            return {
              escalationId: e?.id ?? null,
              projectId: r.id,
              project: r.name,
              issue: e?.issue ?? null,
              severity: e?.severity
                ?? (r.status === "blocked" ? "blocked" : r.status === "delayed" ? "overdue" : "pending"),
              escalatedTo: e?.escalatedTo ?? null,
              raisedDate: (r.createdAt as Date).toISOString().slice(0, 10),
              status: e?.status ?? defaultStatus,
            };
          });
        });
      },
    );

    return reply.send({ data: rows ?? [], meta: paginationMeta((rows ?? []).length, 1, 200) });
  });

  // ─── Beneficiaries ─────────────────────────────────────────────────────────
  app.get("/v1/projects/beneficiaries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const tenantId = ctx.tenantId;

    const rows = await cache.getOrLoad(
      cache.makeKey(tenantId, "project", "beneficiaries"),
      async () => {
        // GAP-PROJECTS-BENEFICIARIES-03 / -01 (DECISION — flagged for HUMAN REVIEW):
        // this handler previously FABRICATED beneficiary rows — synthetic names
        // ("Beneficiary N"), a hard-coded social category ("General"), a fixed
        // verification status ("pending") and a literal "₹0" disbursement string —
        // all derived from project rows, with no real beneficiary table behind
        // them. Per the engineering rules (never invent numbers; remove fabricated
        // data or wire it to real data; where no backend exists show an honest
        // "not available" state), the fabricated rows are removed. There is no
        // beneficiary entity in project-service today, so this returns an empty
        // list and the web register shows its honest "No beneficiaries registered"
        // empty state instead of fake PII/social-category/disbursement figures.
        // A real beneficiary data source (name, district, social category as
        // encrypted PII, disbursement in bigint paise) must be built before this
        // can show rows — see HUMAN REVIEW in the batch report.
        return [] as Array<{
          id: string; name: string; project: string; district: string;
          category: string; verified: string; disbursement: string;
        }>;
      },
    );

    return reply.send({ data: rows ?? [], meta: paginationMeta((rows ?? []).length, 1, 200) });
  });

  // ─── DPR Tracking ──────────────────────────────────────────────────────────
  app.get("/v1/projects/dprs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const tenantId = ctx.tenantId;

    const rows = await cache.getOrLoad(
      cache.makeKey(tenantId, "project", "dprs"),
      async () => {
        // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
        // before these reads — bare db.select() calls run with no RLS GUC set.
        return db.transaction(async (tx) => {
          const result = await tx.select({
            id: projectDprs.id,
            dprNo: projectDprs.dprNo,
            projectId: projectDprs.projectId,
            dprDate: projectDprs.dprDate,
            status: projectDprs.status,
            submittedBy: projectDprs.submittedBy,
          }).from(projectDprs)
            .where(eq(projectDprs.tenantId, tenantId))
            .orderBy(desc(projectDprs.dprDate))
            .limit(200);

          const out = [];
          for (const r of result) {
            const proj = await tx.select({ name: projectProjects.name })
              .from(projectProjects)
              .where(and(eq(projectProjects.id, r.projectId), eq(projectProjects.tenantId, tenantId)))
              .limit(1);
            out.push({
              id: r.id,
              dprNo: r.dprNo,
              projectId: r.projectId,
              projectTitle: proj[0]?.name ?? "Unknown Project",
              submittedBy: r.submittedBy ?? "—",
              submittedDate: r.dprDate?.toString() ?? "—",
              estimatedCost: "—",
              status: r.status,
              reviewingAuthority: "PMU",
            });
          }
          return out;
        });
      },
    );

    return reply.send({ data: rows ?? [], meta: paginationMeta((rows ?? []).length, 1, 200) });
  });

  // ─── WBS ───────────────────────────────────────────────────────────────────
  app.get("/v1/projects/wbs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const tenantId = ctx.tenantId;

    const rows = await cache.getOrLoad(
      cache.makeKey(tenantId, "project", "wbs"),
      async () => {
        // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
        // before this read — a bare db.select() runs with no RLS GUC set.
        const result = await db.transaction((tx) => tx.select({
          id: projectTasks.id,
          name: projectTasks.name,
          status: projectTasks.status,
          parentTaskId: projectTasks.parentTaskId,
          projectId: projectTasks.projectId,
        }).from(projectTasks)
          .where(eq(projectTasks.tenantId, tenantId))
          .orderBy(projectTasks.name)
          .limit(500));
        return result.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          parentId: r.parentTaskId ?? null,
          // GAP-PROJECTS-WBS-03: the query already selects projectId but the
          // mapper used to drop it, so a WBS node could not be traced back to
          // its project (the portfolio endpoint spans every project's tasks).
          // Surface it so the web tree can link a node to /projects/<projectId>.
          projectId: r.projectId,
        }));
      },
    );

    return reply.send({ data: rows ?? [], meta: paginationMeta((rows ?? []).length, 1, 500) });
  });

  // ─── Delay Analysis ────────────────────────────────────────────────────────
  app.get("/v1/projects/delay-analysis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const tenantId = ctx.tenantId;

    const rows = await cache.getOrLoad(
      cache.makeKey(tenantId, "project", "delay-analysis"),
      async () => {
        // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
        // before this read — a bare db.select() runs with no RLS GUC set.
        const result = await db.transaction((tx) => tx.select({
          id: projectProjects.id,
          name: projectProjects.name,
          status: projectProjects.status,
          rag: projectProjects.rag,
          startDate: projectProjects.startDate,
          endDate: projectProjects.endDate,
        }).from(projectProjects)
          .where(eq(projectProjects.tenantId, tenantId))
          .orderBy(desc(projectProjects.createdAt))
          .limit(200));
        // GAP-PROJECTS-DELAY-ANALYSIS-02/03: emit projectId so the UI can link
        // each row to /projects/<id>; surface the project's STORED rag signal
        // (green/amber/red) rather than re-deriving a status-flavoured word;
        // and compute delayDays honestly from endDate vs today (whole days
        // past a planned end that has not completed) instead of the previous
        // fabricated flat "90". There is no stored revised/forecast end date
        // at the project level, so revisedDeadline mirrors endDate and cause
        // is left blank ("—") rather than inventing "Under investigation".
        const todayMs = Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth(),
          new Date().getUTCDate(),
        );
        const overdueDays = (end: string | null, status: string): number => {
          if (!end) return 0;
          if (status === "completed" || status === "cancelled") return 0;
          const [y, m, d] = end.split("-").map(Number);
          if (!y || !m || !d) return 0;
          const endMs = Date.UTC(y, m - 1, d);
          const diff = Math.floor((todayMs - endMs) / 86_400_000);
          return diff > 0 ? diff : 0;
        };
        return result.map((r) => ({
          projectId: r.id,
          project: r.name,
          originalDeadline: r.endDate?.toString() ?? "—",
          revisedDeadline: r.endDate?.toString() ?? "—",
          delayDays: overdueDays(r.endDate?.toString() ?? null, r.status),
          cause: "—",
          rag: r.rag ?? "green",
        }));
      },
    );

    return reply.send({ data: rows ?? [], meta: paginationMeta((rows ?? []).length, 1, 200) });
  });
}
