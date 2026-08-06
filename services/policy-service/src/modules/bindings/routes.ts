import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { readScoped } from "../../shared/db.js";
import { roleBindings } from "./schema.js";
import { createBindingBody, breakglassBody, bindingIdParam } from "./validators.js";
import * as commands from "./commands.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function bindingRoutes(app: FastifyInstance): Promise<void> {
  // The web admin screen talks to the /v1/policy/* namespace (like every other
  // policy module); the bare /policy/* paths predate it and stay for API
  // compatibility. Both register the same handlers.
  const createBinding = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createBindingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBinding(ctx, body));
  };

  const revokeBinding = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = bindingIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeBinding(ctx, id));
  };

  app.post("/policy/bindings", createBinding);
  app.post("/v1/policy/bindings", createBinding);

  app.delete("/policy/bindings/:id", revokeBinding);
  app.delete("/v1/policy/bindings/:id", revokeBinding);

  app.get("/v1/policy/bindings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const rows = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(roleBindings).where(eq(roleBindings.tenantId, ctx.tenantId)),
    );
    return reply.send({ data: rows });
  });

  app.post("/policy/breakglass", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = breakglassBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestBreakglass(ctx, body));
  });
}
