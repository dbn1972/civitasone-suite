import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createBindingBody, breakglassBody, bindingIdParam } from "./validators.js";
import * as commands from "./commands.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function bindingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/policy/bindings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createBindingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBinding(ctx, body));
  });

  app.delete("/policy/bindings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = bindingIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeBinding(ctx, id));
  });

  app.post("/policy/breakglass", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = breakglassBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestBreakglass(ctx, body));
  });
}
