import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN_ROLES = ["install_admin", "super_admin", "platform_admin"];
const READER_ROLES = [...ADMIN_ROLES, "install_user"];

const listQuery = z.object({
  status: z.enum(["requested", "provisioning", "ready", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const updateBody = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(["provisioning", "ready", "failed"]),
  error: z.string().max(2000).nullable().optional(),
  steps: z.array(z.object({ step: z.string(), ok: z.boolean(), detail: z.string().optional() })).optional(),
});

export async function provisioningRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/install/silo-provisions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuery.parse(req.query);
    return reply.send({ data: await queries.listProvisions(q.limit, q.status) });
  });

  app.get("/v1/install/silo-provisions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await queries.getProvision(id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "provision record not found");
    return reply.send({ data: row });
  });

  /** Runner/ops reports provisioning progress (provisioning → ready | failed). */
  app.patch("/v1/install/silo-provisions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateProvision(ctx, id, body));
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
