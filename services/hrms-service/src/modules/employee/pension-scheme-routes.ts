/**
 * UAT b18 D1: HTTP routes for pension scheme changes. Validation and role
 * gates only; the writes (maker-checker, audit, effective date) live in
 * pension-scheme-commands.ts.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, desc } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { resolveContext, requireRole } from "../../shared/context.js";
import { hrmsPensionSchemeChanges } from "./schema.js";
import {
  MAKER_ROLES, CHECKER_ROLES, READER_ROLES, idParam, changeIdParam, approveBody, rejectBody, listQuery,
  pensionSchemeChangeBody, requestPensionSchemeChange, approvePensionSchemeChange, rejectPensionSchemeChange, shape,
} from "./pension-scheme-commands.js";

export { pensionSchemeChangeBody } from "./pension-scheme-commands.js";

export async function pensionSchemeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/:id/pension-scheme-changes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MAKER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = pensionSchemeChangeBody.parse(req.body);
    return reply.code(201).send(await requestPensionSchemeChange(ctx, id, body));
  });

  app.post("/v1/hrms/pension-scheme-changes/:changeId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHECKER_ROLES);
    const { changeId } = changeIdParam.parse(req.params);
    const body = approveBody.parse(req.body ?? {});
    return reply.send(await approvePensionSchemeChange(ctx, changeId, body));
  });

  app.post("/v1/hrms/pension-scheme-changes/:changeId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHECKER_ROLES);
    const { changeId } = changeIdParam.parse(req.params);
    const body = rejectBody.parse(req.body);
    return reply.send(await rejectPensionSchemeChange(ctx, changeId, body));
  });

  app.get("/v1/hrms/employees/:id/pension-scheme-changes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsPensionSchemeChanges)
      .where(and(eq(hrmsPensionSchemeChanges.tenantId, ctx.tenantId), eq(hrmsPensionSchemeChanges.employeeId, id)))
      .orderBy(desc(hrmsPensionSchemeChanges.effectiveFrom), desc(hrmsPensionSchemeChanges.createdAt)).limit(200));
    return reply.send({ data: rows.map(shape) });
  });

  app.get("/v1/hrms/pension-scheme-changes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuery.parse(req.query);
    const where = q.status
      ? and(eq(hrmsPensionSchemeChanges.tenantId, ctx.tenantId), eq(hrmsPensionSchemeChanges.status, q.status))
      : eq(hrmsPensionSchemeChanges.tenantId, ctx.tenantId);
    const rows = await scopedRead((tx) => tx.select().from(hrmsPensionSchemeChanges).where(where)
      .orderBy(desc(hrmsPensionSchemeChanges.createdAt)).limit(200));
    return reply.send({ data: rows.map(shape) });
  });
}
