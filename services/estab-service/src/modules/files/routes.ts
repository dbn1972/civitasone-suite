import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, createFileBody, addNotingBody, moveFileBody, closeFileBody,
  createDispatchBody, registerInwardBody, submitNotingBody, openFileFromInwardBody,
  addAttachmentBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { noteSheetPrintRoutes } from "./note-sheet-print/routes.js";
import { isTopSecret } from "./domain.js";
import { enqueue } from "../../shared/outbox.js";
import { db } from "../../shared/db.js";

const ESTAB_ROLES  = ["estab_officer", "estab_admin", "estab_deputy_secretary", "super_admin"];
const READER_ROLES = [...ESTAB_ROLES, "audit_officer"];

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/estab/files", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = createFileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFile(ctx, body));
  });

  app.post("/v1/estab/files/:id/notings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = addNotingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addNoting(ctx, id, body));
  });

  app.post("/v1/estab/files/:id/submit-for-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitNotingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitNotingForApproval(ctx, id, body));
  });

  app.patch("/v1/estab/files/:id/move", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = moveFileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.moveFile(ctx, id, body));
  });

  app.patch("/v1/estab/files/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeFileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeFile(ctx, id, body));
  });

  app.post("/v1/estab/dispatch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = createDispatchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDispatch(ctx, body));
  });

  app.post("/v1/estab/inward", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = registerInwardBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.registerInward(ctx, body));
  });

  app.post("/v1/estab/inward/:id/open-file", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = openFileFromInwardBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.openFileFromInward(ctx, id, body));
  });

  app.get("/v1/estab/files", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const files = await queries.listFiles(ctx.tenantId, q.limit);
    return reply.send({ data: files, pagination: { hasMore: files.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/estab/inward", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await queries.listInward(ctx.tenantId, q.limit);
    return reply.send({ data: rows, pagination: { hasMore: rows.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/estab/dispatch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await queries.listDispatch(ctx.tenantId, q.limit);
    return reply.send({ data: rows, pagination: { hasMore: rows.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/estab/files/:id/movements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const movements = await queries.listFileMovements(ctx.tenantId, id);
    return reply.send({ data: movements });
  });

  app.post("/v1/estab/files/:id/attachments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = addAttachmentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addAttachment(ctx, id, body));
  });

  app.get("/v1/estab/files/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const file = await queries.getFileDetail(ctx.tenantId, id);
    if (!file) throw new HttpError(404, "NOT_FOUND", "file not found");
    if (isTopSecret(file.classification)) {
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: "audit.event.record", eventType: "audit.event.record",
          tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
          payload: { service: "estab", action: "read_top_secret", resourceType: "file", resourceId: id, outcome: "success", breakGlass: true },
        });
      });
    }
    return reply.send(file);
  });

  await app.register(noteSheetPrintRoutes);

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
