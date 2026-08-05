import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createPipelineBody, updatePipelineBody, idParam, pipelineListQuery, pipelinesListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

export async function pipelineRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/pipelines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createPipelineBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPipeline(ctx, body));
  });

  app.get("/v1/crm/pipelines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = pipelineListQuery.parse(req.query ?? {});
    const scope = {
      ...(q.product !== undefined ? { product: q.product } : {}),
      ...(q.region !== undefined ? { region: q.region } : {}),
      ...(q.businessUnit !== undefined ? { businessUnit: q.businessUnit } : {}),
    };
    sendValidated(reply, pipelinesListSchema, await queries.listPipelines(ctx.tenantId, q.limit, q.offset, scope));
  });

  app.get("/v1/crm/pipelines/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const pipeline = await queries.getPipeline(id, ctx.tenantId);
    if (!pipeline) throw new HttpError(404, "NOT_FOUND", "pipeline not found");
    return reply.send({ data: pipeline });
  });

  app.patch("/v1/crm/pipelines/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updatePipelineBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updatePipeline(ctx, id, body));
  });

  app.delete("/v1/crm/pipelines/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deletePipeline(ctx, id));
  });
}
