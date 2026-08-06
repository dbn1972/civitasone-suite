import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createAgentScriptBody, updateAgentScriptBody, idParam, agentScriptListQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const READ_ROLES = ["crm_user", "crm_admin", "super_admin"];
const WRITE_ROLES = ["crm_admin", "super_admin"];

export async function agentScriptRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/agent-scripts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = agentScriptListQuery.parse(req.query);
    const result = await queries.listAgentScripts(ctx.tenantId, q.limit, q.offset, q.product_code, q.language);
    return reply.send(result);
  });

  app.get("/v1/crm/agent-scripts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const script = await queries.getAgentScript(id, ctx.tenantId);
    if (!script) throw new HttpError(404, "NOT_FOUND", "agent script not found");
    return reply.send({ data: script });
  });

  app.post("/v1/crm/agent-scripts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createAgentScriptBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAgentScript(ctx, body));
  });

  app.patch("/v1/crm/agent-scripts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateAgentScriptBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateAgentScript(ctx, id, body));
  });

  app.post("/v1/crm/agent-scripts/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.publishAgentScript(ctx, id));
  });

  app.post("/v1/crm/agent-scripts/:id/deprecate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deprecateAgentScript(ctx, id));
  });
}
