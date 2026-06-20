import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, HttpError } from "../../shared/context.js";
import { createSessionBody, sessionIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identity/sessions", { config: { public: true } }, async (req, reply) => {
    const body = createSessionBody.parse(req.body);
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    const ctx: RequestContext = {
      tenantId: body.tenantId,
      actorId: body.userId,
      actorType: "user",
      roles: [],
      correlationId,
      sessionId: "",
    };
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSession(ctx, body));
  });

  app.delete("/identity/sessions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = sessionIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeSession(ctx, id));
  });

  app.get("/identity/sessions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = sessionIdParam.parse(req.params);
    const view = await queries.getSession(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "session not found");
    return reply.send(view);
  });
}
