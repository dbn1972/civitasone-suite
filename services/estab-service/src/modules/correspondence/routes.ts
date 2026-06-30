import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, pucParam, addCorrespondenceBody, markPucBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ESTAB_ROLES  = ["estab_officer", "estab_admin", "estab_deputy_secretary", "super_admin"];
const READER_ROLES = [...ESTAB_ROLES, "audit_officer"];

export async function correspondenceRoutes(app: FastifyInstance): Promise<void> {
  // Add a correspondence entry (assigns running corr_no + stable page range).
  app.post("/v1/estab/files/:id/correspondence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = addCorrespondenceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addCorrespondence(ctx, id, body));
  });

  // List correspondence on a file, tenant-scoped, ordered by page_from.
  app.get("/v1/estab/files/:id/correspondence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await repo.listCorrespondenceByFile(id, ctx.tenantId);
    return reply.send({ data: rows });
  });

  // Mark a correspondence as a current PUC (multiple active PUCs allowed).
  app.post("/v1/estab/files/:id/puc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = markPucBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.markPuc(ctx, id, body));
  });

  // Unmark a PUC (sets active = false).
  app.delete("/v1/estab/files/:id/puc/:correspondenceId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id, correspondenceId } = pucParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.unmarkPuc(ctx, id, correspondenceId));
  });

  // List active PUCs on a file.
  app.get("/v1/estab/files/:id/puc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await repo.listActivePucByFile(id, ctx.tenantId);
    return reply.send({ data: rows });
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
