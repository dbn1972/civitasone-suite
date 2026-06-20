import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, createCommitteeBody, createMeetingBody, createResolutionBody, minutesBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ESTAB_ROLES  = ["estab_officer", "estab_admin", "super_admin"];
const READER_ROLES = [...ESTAB_ROLES, "audit_officer"];

export async function committeeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/estab/committees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = createCommitteeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCommittee(ctx, body));
  });

  app.post("/v1/estab/committees/:id/meetings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createMeetingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createMeeting(ctx, id, body));
  });

  app.post("/v1/estab/meetings/:id/resolutions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createResolutionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createResolution(ctx, id, body));
  });

  app.patch("/v1/estab/meetings/:id/minutes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = minutesBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.uploadMinutes(ctx, id, body));
  });

  app.get("/v1/estab/committees/:id/meetings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const meetings = await queries.getMeetingsByCommittee(ctx.tenantId, id);
    return reply.send({ data: meetings });
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
