import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as licRepo from "../licences/repo.js";
import { canDecideLifecycle } from "./domain.js";

const VENDOR_ROLES = ["vendor_user", "vendor_admin", "super_admin"];
const ADMIN_ROLES = ["vendor_admin", "super_admin"];

const renewalBody = z.object({ licenceId: z.string().uuid() });
const zoneTransferBody = z.object({
  licenceId: z.string().uuid(),
  newZone: z.string().min(1),
  newSpot: z.string().min(1),
});
const cancellationBody = z.object({
  licenceId: z.string().uuid(),
  reason: z.string().min(1),
});
const surrenderBody = z.object({
  licenceId: z.string().uuid(),
  reason: z.string().min(1),
});
const decideBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
  newValidUntil: z.string().datetime().optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const licenceIdQuery = z.object({ licenceId: z.string().uuid() });

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/vendor/lifecycle/renewal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const body = renewalBody.parse(req.body);
    const lic = await licRepo.findById(body.licenceId, ctx.tenantId);
    if (!lic) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    if (lic.status !== "active") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot renew licence in status '${lic.status}'`);
    }
    return reply.code(202).send(await commands.requestRenewal(ctx, body.licenceId));
  });

  app.post("/v1/vendor/lifecycle/zone-transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const body = zoneTransferBody.parse(req.body);
    const lic = await licRepo.findById(body.licenceId, ctx.tenantId);
    if (!lic) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    if (lic.status !== "active") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot transfer zone for licence in status '${lic.status}'`);
    }
    return reply.code(202).send(await commands.requestZoneTransfer(ctx, body.licenceId, body.newZone, body.newSpot));
  });

  app.post("/v1/vendor/lifecycle/cancellation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const body = cancellationBody.parse(req.body);
    const lic = await licRepo.findById(body.licenceId, ctx.tenantId);
    if (!lic) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    return reply.code(202).send(await commands.requestCancellation(ctx, body.licenceId, body.reason));
  });

  app.post("/v1/vendor/lifecycle/surrender", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const body = surrenderBody.parse(req.body);
    const lic = await licRepo.findById(body.licenceId, ctx.tenantId);
    if (!lic) throw new HttpError(404, "LICENCE_NOT_FOUND", "Licence not found");
    return reply.code(202).send(await commands.requestSurrender(ctx, body.licenceId, body.reason));
  });

  app.get("/v1/vendor/lifecycle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VENDOR_ROLES);
    const q = licenceIdQuery.parse(req.query);
    const records = await repo.listByLicence(q.licenceId, ctx.tenantId);
    return reply.send({
      data: records,
      meta: { page: 1, pageSize: records.length, total: records.length },
    });
  });

  app.post("/v1/vendor/lifecycle/:id/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = decideBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REQUEST_NOT_FOUND", "Lifecycle request not found");
    if (!canDecideLifecycle(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot decide request in status '${existing.status}'`);
    }
    return reply.code(202).send(
      await commands.decideLifecycleRequest(ctx, id, body.decision, body.reason, body.newValidUntil),
    );
  });
}
