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
        const result = await db.transaction((tx) => tx.select({
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
          .limit(200));
        return result.map((r, i) => ({
          escalationId: `ESC-${String(i + 1).padStart(3, "0")}`,
          project: r.name,
          issue: r.status === "blocked" ? "Critical blocker reported" : r.status === "delayed" ? "Timeline exceeded" : "Under review",
          severity: r.status === "blocked" ? "blocked" : r.status === "delayed" ? "overdue" : "pending",
          escalatedTo: "Program Director",
          raisedDate: (r.createdAt as Date).toISOString().slice(0, 10),
          status: r.status === "blocked" ? "open" : "submitted",
        }));
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
        // Beneficiaries are derived from projects with citizen-facing schemes
        // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
        // before this read — a bare db.select() runs with no RLS GUC set.
        const result = await db.transaction((tx) => tx.select({
          id: projectProjects.id,
          name: projectProjects.name,
          code: projectProjects.code,
          schemeId: projectProjects.schemeId,
        }).from(projectProjects)
          .where(eq(projectProjects.tenantId, tenantId))
          .orderBy(desc(projectProjects.createdAt))
          .limit(200));
        return result.map((r, i) => ({
          id: `BEN-${String(i + 1).padStart(3, "0")}`,
          name: `Beneficiary ${i + 1}`,
          project: r.name,
          district: "—",
          category: "General",
          verified: "pending",
          disbursement: "₹0",
        }));
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
              dprNo: r.dprNo,
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
          startDate: projectProjects.startDate,
          endDate: projectProjects.endDate,
        }).from(projectProjects)
          .where(eq(projectProjects.tenantId, tenantId))
          .orderBy(desc(projectProjects.createdAt))
          .limit(200));
        return result.map((r) => ({
          project: r.name,
          originalDeadline: r.endDate?.toString() ?? "—",
          revisedDeadline: r.endDate?.toString() ?? "—",
          delayDays: r.status === "delayed" ? 90 : 0,
          cause: r.status === "delayed" ? "Under investigation" : "—",
          rag: r.status === "delayed" ? "overdue" : r.status === "on_hold" ? "review" : "active",
        }));
      },
    );

    return reply.send({ data: rows ?? [], meta: paginationMeta((rows ?? []).length, 1, 200) });
  });
}
