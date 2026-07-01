import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, assignCategoryBody, recordDisposalBody, proposeWeedoutBody,
  rejectWeedoutBody, destroyWeedoutBody, listWeedoutQuery,
  transferToRecordRoomBody, requisitionRecordBody, returnRecordBody, listRequisitionsQuery,
  archiveFileBody, recordNaiTransferBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["estab_admin", "super_admin", "records_officer"];
const READ_ROLES  = [...WRITE_ROLES, "audit_officer"];

export async function recordsRoutes(app: FastifyInstance): Promise<void> {
  // Assign / re-assign the CSMOP record category for a file.
  app.post("/v1/estab/files/:id/record-category", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignCategoryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignCategory(ctx, id, body));
  });

  // Read the record-management row for a file.
  app.get("/v1/estab/files/:id/record", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const record = await repo.findRecord(ctx.tenantId, id);
    if (!record) throw new HttpError(404, "NOT_FOUND", "record not found");
    return reply.send(record);
  });

  // Record a disposal action against the file's record.
  app.post("/v1/estab/files/:id/disposal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recordDisposalBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordDisposal(ctx, id, body));
  });

  // Weed-out workflow: propose → approve/reject → destroy.
  app.post("/v1/estab/weedout", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = proposeWeedoutBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.proposeWeedout(ctx, body));
  });

  app.post("/v1/estab/weedout/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveWeedout(ctx, id));
  });

  app.post("/v1/estab/weedout/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectWeedoutBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectWeedout(ctx, id, body));
  });

  app.post("/v1/estab/weedout/:id/destroy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = destroyWeedoutBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.destroyWeedout(ctx, id, body));
  });

  app.get("/v1/estab/weedout", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listWeedoutQuery.parse(req.query);
    const rows = await repo.listWeedoutByTenant(ctx.tenantId, q.status, q.limit);
    return reply.send({ data: rows, pagination: { hasMore: rows.length === q.limit, pageSize: q.limit } });
  });

  // ── R4 record-room management ───────────────────────────────────────────

  app.post("/v1/estab/files/:id/transfer-to-record-room", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferToRecordRoomBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.transferToRecordRoom(ctx, id, body));
  });

  app.post("/v1/estab/record-requisitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = requisitionRecordBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requisitionRecord(ctx, body));
  });

  app.post("/v1/estab/record-requisitions/return", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = returnRecordBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.returnRecord(ctx, body));
  });

  app.get("/v1/estab/record-requisitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listRequisitionsQuery.parse(req.query);
    const rows = await repo.listRequisitions(ctx.tenantId, q.status, q.limit);
    return reply.send({ data: rows, pagination: { hasMore: rows.length === q.limit, pageSize: q.limit } });
  });

  // ── R5 archival & NAI ───────────────────────────────────────────────────

  app.post("/v1/estab/files/:id/archive", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = archiveFileBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.archiveFile(ctx, id, body));
  });

  app.post("/v1/estab/files/:id/nai-transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recordNaiTransferBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordNaiTransfer(ctx, id, body));
  });

  app.get("/v1/estab/archival/nai-due", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const rows = await repo.listNaiDue(ctx.tenantId, 100);
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
