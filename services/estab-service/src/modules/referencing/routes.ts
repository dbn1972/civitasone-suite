import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { addReferenceBody, removeReferenceBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["estab_officer", "estab_admin", "super_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer"];

export async function referencingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/files/:fileId/references", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { fileId } = req.params as { fileId: string };
    const data = await repo.listReferencesByFile(ctx.tenantId, fileId);
    return reply.send({ data });
  });

  app.get("/v1/estab/notings/:noteId/references", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { noteId } = req.params as { noteId: string };
    const data = await repo.listReferencesByNote(ctx.tenantId, noteId);
    return reply.send({ data });
  });

  app.post("/v1/estab/references", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = addReferenceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addReference(ctx, body));
  });

  app.post("/v1/estab/references/remove", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = removeReferenceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.removeReference(ctx, body));
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
