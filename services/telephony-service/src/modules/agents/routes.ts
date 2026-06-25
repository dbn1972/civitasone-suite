/** agents HTTP routes. zod-validated; tenant-scoped; RBAC enforced. */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { upsertAgentBody, setAgentStatusBody, idParam, agentsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const TELEPHONY_ROLES = ["telephony_user", "telephony_supervisor", "telephony_admin", "super_admin"];
const SUPERVISOR_ROLES = ["telephony_supervisor", "telephony_admin", "super_admin"];

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/telephony/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, agentsListSchema, await queries.listAgents(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/telephony/agents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getAgent(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "agent not found");
    return reply.send(row);
  });

  app.post("/v1/telephony/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUPERVISOR_ROLES);
    const body = upsertAgentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertAgent(ctx, body));
  });

  // Agents set their own presence; supervisors/admins may set anyone's.
  app.post("/v1/telephony/agents/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = setAgentStatusBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setAgentStatus(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
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
