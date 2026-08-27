import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as appRepo from "../applications/repo.js";

const FIRE_ROLES = ["fire_user", "fire_admin", "super_admin"];
const OFFICER_ROLES = ["fire_admin", "fire_officer", "fire_inspector", "super_admin"];

const scheduleBody = z.object({
  applicationId: z.string().uuid(),
  inspectorId: z.string().uuid(),
  scheduledDate: z.string().date(),
});

const completeBody = z.object({
  recommendation: z.enum(["approve", "reject", "re_inspect"]),
  deficiencies: z.array(z.object({ description: z.string(), severity: z.string().optional() })).optional(),
});

const findingsBody = z.object({
  findings: z.array(z.object({ description: z.string(), compliant: z.boolean().optional() })),
});

const idParam = z.object({ id: z.string().uuid() });
const appIdParam = z.object({ applicationId: z.string().uuid() });

export async function inspectionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/fire/inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = scheduleBody.parse(req.body);
    const application = await appRepo.findById(ctx.tenantId, body.applicationId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    return reply.code(202).send(await commands.scheduleInspection(ctx, body));
  });

  app.get("/v1/fire/inspections/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `fire:${ctx.tenantId}:inspection:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(ctx.tenantId, id));
    if (!row) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Inspection not found");
    return reply.send({ data: row });
  });

  app.get("/v1/fire/inspections/by-application/:applicationId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIRE_ROLES);
    const { applicationId } = appIdParam.parse(req.params);
    const rows = await repo.findByApplicationId(ctx.tenantId, applicationId);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/fire/inspections/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Inspection not found");
    if (existing.status !== "scheduled") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot complete inspection in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.completeInspection(ctx, id, body));
  });

  app.post("/v1/fire/inspections/:id/findings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = findingsBody.parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Inspection not found");
    return reply.code(202).send(await commands.recordFindings(ctx, id, body));
  });
}
