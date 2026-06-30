import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createOrgUnitBody, updateOrgUnitBody, listOrgUnitsQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const WRITE_ROLES = ["estab_admin", "super_admin"];
const READ_ROLES = [...WRITE_ROLES, "estab_division_admin", "estab_officer", "audit_officer"];

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/org-units", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listOrgUnitsQuery.parse(req.query);
    const data = await queries.listOrgUnits(ctx.tenantId, { type: q.type, parentId: q.parentId, activeOnly: q.activeOnly }, q.limit);
    return reply.send({ data });
  });

  app.get("/v1/estab/org-units/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = req.params as { id: string };
    const unit = await queries.getOrgUnit(ctx.tenantId, id);
    if (!unit) throw new HttpError(404, "NOT_FOUND", "org unit not found");
    return reply.send({ data: unit });
  });

  app.get("/v1/estab/org-units/:id/ancestors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = req.params as { id: string };
    const data = await queries.getAncestors(ctx.tenantId, id);
    return reply.send({ data });
  });

  app.post("/v1/estab/org-units", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createOrgUnitBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createOrgUnit(ctx, body));
  });

  app.patch("/v1/estab/org-units/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = req.params as { id: string };
    const body = updateOrgUnitBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateOrgUnit(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
