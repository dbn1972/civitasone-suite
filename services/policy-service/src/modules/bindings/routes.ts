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
    // SEC: this handler had no requireRole call at all, unlike both sibling
    // mutating routes in this file (createBinding/revokeBinding, which gate on
    // the same ADMIN roles below). requestBreakglass() currently only inserts
    // a 'pending' row (nothing consumes/approves it yet — see commands.ts /
    // consumer.ts), so this was not exploitable for actual privilege
    // escalation today, but any authenticated user of any role, in any
    // tenant, could otherwise spam breakglass requests for an arbitrary
    // `scope` string. Gate it the same as its siblings for consistency and
    // defense-in-depth ahead of the approval flow being built out.
    requireRole(ctx, ADMIN);
    const body = breakglassBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestBreakglass(ctx, body));
  });
}
