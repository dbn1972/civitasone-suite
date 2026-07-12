/**
 * Scheduler / due-list read + manual-trigger routes.
 *
 *   GET  /v1/hrms/scheduler/due-list?kind=superannuation|probation[&runDate=YYYY-MM-DD]
 *        Latest (or specified-day) due-list snapshot for the tenant.
 *   GET  /v1/hrms/scheduler/runs            Recent scheduler run markers.
 *   POST /v1/hrms/scheduler/run             Manually trigger a tick (admin).
 *
 * The list is materialised by the worker tick; these routes only read it (and
 * allow an admin to force a run on demand). All tenant-scoped.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsDueList, hrmsSchedulerRuns } from "./schema.js";
import { runSchedulerOnce } from "./tick.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export async function schedulerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/scheduler/due-list", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const q = z.object({
      kind: z.enum(["superannuation", "probation"]),
      runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.query);

    let runDate = q.runDate;
    if (!runDate) {
      const latest = await scopedRead((tx) => tx.select({ runDate: hrmsDueList.runDate })
        .from(hrmsDueList)
        .where(and(eq(hrmsDueList.tenantId, ctx.tenantId), eq(hrmsDueList.listKind, q.kind)))
        .orderBy(desc(hrmsDueList.runDate)).limit(1));
      runDate = latest[0]?.runDate;
    }
    if (!runDate) return reply.send({ kind: q.kind, runDate: null, data: [] });

    const rows = await scopedRead((tx) => tx.select().from(hrmsDueList)
      .where(and(
        eq(hrmsDueList.tenantId, ctx.tenantId),
        eq(hrmsDueList.listKind, q.kind),
        eq(hrmsDueList.runDate, runDate)))
      .orderBy(sql`${hrmsDueList.daysRemaining} ASC`));
    return reply.send({ kind: q.kind, runDate, count: rows.length, data: rows });
  });

  app.get("/v1/hrms/scheduler/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsSchedulerRuns)
      .orderBy(desc(hrmsSchedulerRuns.startedAt)).limit(20));
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/scheduler/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["super_admin", "hr_admin"]);
    const body = z.object({
      asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      superannuationWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
      probationWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
    }).parse(req.body ?? {});
    const result = await runSchedulerOnce(db, {
      ...(body.asOf ? { asOf: body.asOf } : {}),
      ...(body.superannuationWithinDays ? { superannuationWithinDays: body.superannuationWithinDays } : {}),
      ...(body.probationWithinDays ? { probationWithinDays: body.probationWithinDays } : {}),
    });
    return reply.send(result);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
