import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { assignJurisdictionBody, jurisdictionQueryParams, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const JURISDICTION_ROLES = ["location_admin", "super_admin", "admin"];

export async function jurisdictionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/jurisdictions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JURISDICTION_ROLES);
    const q = jurisdictionQueryParams.parse(req.query);

    let data;
    if (q.officeId) {
      data = await repo.findByOffice(q.officeId, ctx.tenantId);
    } else if (q.unitId) {
      data = await repo.findByUnit(q.unitId, ctx.tenantId);
    } else {
      data = await repo.listByTenant(ctx.tenantId, 100, 0);
    }
    return reply.send({ data });
  });

  app.post("/v1/jurisdictions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JURISDICTION_ROLES);
    const body = assignJurisdictionBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.jurisdictionAssign(ctx, body));
  });

  app.delete("/v1/jurisdictions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JURISDICTION_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "jurisdiction not found");
    sendAccepted(reply, acceptedResponseSchema, await commands.jurisdictionRevoke(ctx, id));
  });
}
