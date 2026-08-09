import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canDecide } from "./domain.js";
import * as appRepo from "../applications/repo.js";

const OFFICER_ROLES = ["building_admin", "building_officer", "super_admin"];

const initiateBody = z.object({
  applicationId: z.string().uuid(),
  discipline: z.enum(["structural", "fire", "environmental", "heritage", "general"]),
  officerId: z.string().uuid(),
});
const completeBody = z.object({
  findings: z.record(z.unknown()),
  dcrResults: z.record(z.unknown()).optional(),
  deficiencyDetails: z.string().optional(),
});
const decideBody = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});
const idParam = z.object({ id: z.string().uuid() });
const applicationIdQuery = z.object({ applicationId: z.string().uuid() });

export async function scrutinyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/building/scrutiny", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = initiateBody.parse(req.body);
    const application = await appRepo.findById(body.applicationId, ctx.tenantId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (application.status !== "submitted" && application.status !== "under_scrutiny") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot scrutinize application in status '${application.status}'`);
    }
    return reply.code(202).send(await commands.initiateScrutiny(ctx, body.applicationId, body.discipline, body.officerId));
  });

  app.get("/v1/building/scrutiny", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const q = applicationIdQuery.parse(req.query);
    const records = await repo.listByApplication(q.applicationId, ctx.tenantId);
    return reply.send({ data: records, meta: { page: 1, pageSize: records.length, total: records.length } });
  });

  app.post("/v1/building/scrutiny/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "SCRUTINY_NOT_FOUND", "Scrutiny record not found");
    if (existing.status !== "pending") throw new HttpError(422, "ALREADY_COMPLETED", "Scrutiny already completed");
    return reply.code(202).send(await commands.completeScrutiny(ctx, id, body.findings, body.dcrResults, body.deficiencyDetails));
  });

  app.post("/v1/building/scrutiny/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = decideBody.parse(req.body);
    const application = await appRepo.findById(body.applicationId, ctx.tenantId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canDecide(application.status)) throw new HttpError(422, "INVALID_STATUS", `Cannot decide application in status '${application.status}'`);
    return reply.code(202).send(await commands.decideApplication(ctx, body.applicationId, body.decision, body.reason));
  });
}
