/**
 * dashboard module — KPI aggregates for inspection-service.
 *
 * GET /v1/inspection/dashboard — counts across inspections, findings, assignments,
 *                                CAPA, licences — all scoped to caller's tenant.
 */
import type { FastifyInstance } from "fastify";
import { sql, eq, and, not, inArray } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { inspections } from "../execution/schema.js";
import { findings } from "../findings/schema.js";
import { inspectionAssignments } from "../assignment/schema.js";
import { correctiveActions } from "../capa/schema.js";
import { licences } from "../licence/schema.js";

const ROLES = [
  "inspector", "reviewing_officer", "supervising_officer",
  "inspection_admin", "tenant_admin", "super_admin",
];

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/inspection/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const tid = ctx.tenantId;

    const kpis = await scopedRead(async (tx) => {
      const [totalRows, finalizedRows, findingRows, assignRows, capaRows, licenceRows] =
        await Promise.all([
          tx.select({ count: sql<number>`count(*)::int` })
            .from(inspections).where(eq(inspections.tenantId, tid)),
          tx.select({ count: sql<number>`count(*)::int` })
            .from(inspections).where(and(eq(inspections.tenantId, tid), eq(inspections.state, "finalized"))),
          tx.select({ count: sql<number>`count(*)::int` })
            .from(findings).where(and(eq(findings.tenantId, tid), eq(findings.state, "open"))),
          tx.select({ count: sql<number>`count(*)::int` })
            .from(inspectionAssignments)
            .where(and(eq(inspectionAssignments.tenantId, tid), eq(inspectionAssignments.status, "assigned"))),
          tx.select({ count: sql<number>`count(*)::int` })
            .from(correctiveActions)
            .where(and(
              eq(correctiveActions.tenantId, tid),
              not(inArray(correctiveActions.status, ["closed", "verified"])),
            )),
          tx.select({ count: sql<number>`count(*)::int` })
            .from(licences).where(and(eq(licences.tenantId, tid), eq(licences.status, "active"))),
        ]);

      return {
        totalInspections:     Number(totalRows[0]?.count     ?? 0),
        finalizedInspections: Number(finalizedRows[0]?.count ?? 0),
        openFindings:         Number(findingRows[0]?.count   ?? 0),
        assignedInspections:  Number(assignRows[0]?.count    ?? 0),
        openCapa:             Number(capaRows[0]?.count      ?? 0),
        activeLicences:       Number(licenceRows[0]?.count   ?? 0),
        generatedAt:          new Date().toISOString(),
      };
    });

    return reply.send({ data: kpis });
  });
}
