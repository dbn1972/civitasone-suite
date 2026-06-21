import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];
import { z } from "zod";
import { enableMfaBody, enableMfa } from "./commands.js";

export async function mfaRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identity/users/:id/mfa", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (ctx.actorId !== id) requireRole(ctx, ADMIN);
    const body = enableMfaBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await enableMfa(ctx, id, body));
  });
}
