import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, createFileBody, addNotingBody, moveFileBody, closeFileBody,
  createDispatchBody, registerInwardBody, submitNotingBody, openFileFromInwardBody,
  addAttachmentBody, recallFileBody, reopenFileBody, attachInwardBody, detachInwardBody,
  deliveryUpdateBody, fileSearchQuery,
  openVolumeBody, openPartFileBody, linkFileBody, setFileTypeBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { noteSheetPrintRoutes } from "./note-sheet-print/routes.js";
import { isTopSecret } from "./domain.js";
import { enqueue } from "../../shared/outbox.js";
import { db } from "../../shared/db.js";
import { isMoveAllowed, isAccessAllowed } from "../operators/eligibility.js";

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

  // ── R2 file-type taxonomy ─────────────────────────────────────────────────
  app.post("/v1/estab/files/:id/volumes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = openVolumeBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.openVolume(ctx, id, body));
  });

  app.post("/v1/estab/files/:id/parts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = openPartFileBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.openPartFile(ctx, id, body));
  });

  app.post("/v1/estab/files/:id/links", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = linkFileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.linkFile(ctx, id, body));
  });

  app.patch("/v1/estab/files/:id/type", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = setFileTypeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setFileType(ctx, id, body));
  });

  app.post("/v1/estab/files/:id/submit-for-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitNotingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitNotingForApproval(ctx, id, body));
  });

  // G2 — sign (green) a specific noting at this officer's level. The file
  // accumulates a hash-chained chain of green notes (SO → US → DS).
  app.post("/v1/estab/files/:id/notings/:notingId/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const { notingId } = z.object({ notingId: z.string().uuid() }).parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.signNoting(ctx, id, notingId));
  });

  app.patch("/v1/estab/files/:id/move", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = moveFileBody.parse(req.body);
    // O6 — a file may only be marked to an ACTIVE enrolled eOffice operator,
    // enforced once the tenant has adopted the operator model (so existing /
    // greenfield flows aren't broken before operators are set up).
    if (!(await isMoveAllowed(ctx.tenantId, body.toOfficer))) {
      throw new HttpError(422, "NOT_AN_OPERATOR", "the receiving officer is not an active eOffice operator; enrol them in the division first");
    }
    // Classification gate: the receiving officer must be cleared for this file.
    const target = await queries.getFileDetail(ctx.tenantId, id);
    if (target && !(await isAccessAllowed(ctx.tenantId, body.toOfficer, target.classification))) {
      throw new HttpError(422, "INSUFFICIENT_CLEARANCE", "the receiving officer's clearance is below this file's classification");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.moveFile(ctx, id, body));
  });

  app.patch("/v1/estab/files/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeFileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeFile(ctx, id, body));
  });

  // CSMOP movement verb — recall a wrongly-marked file back to the sender.
  app.patch("/v1/estab/files/:id/recall", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recallFileBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.recallFile(ctx, id, body));
  });

  // CSMOP — reopen a closed file with a recorded reason.
  app.patch("/v1/estab/files/:id/reopen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reopenFileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reopenFile(ctx, id, body));
  });

  // Attach an already-diarised receipt to an existing file.
  app.post("/v1/estab/files/:id/attach-receipt", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = attachInwardBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.attachInward(ctx, body, id));
  });

  // Detach a wrongly-attached receipt (reason mandatory, audited).
  app.post("/v1/estab/inward/detach", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = detachInwardBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.detachInward(ctx, body));
  });

  // Record dispatch delivery proof/status.
  app.post("/v1/estab/dispatch/delivery", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = deliveryUpdateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDelivery(ctx, body));
  });

  app.get("/v1/estab/inward/:id/movements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const movements = await queries.listInwardMovements(ctx.tenantId, id);
    return reply.send({ data: movements });
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

  // CSMOP full-text search — by subject / file number / department / note-sheet content.
  app.get("/v1/estab/files/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { q, limit } = fileSearchQuery.parse(req.query);
    const hits = await queries.searchFiles(ctx.tenantId, q, limit);
    return reply.send({ data: hits, query: q });
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
    // CSMOP classification-based access control: deny if the officer's clearance
    // is below the file's classification (once the tenant adopts the operator
    // model). The denial itself is audited.
    if (!(await isAccessAllowed(ctx.tenantId, ctx.actorId, file.classification))) {
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: "audit.event.record", eventType: "audit.event.record",
          tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
          payload: { service: "estab", action: "access_denied_clearance", resourceType: "file", resourceId: id, outcome: "denied", classification: file.classification },
        });
      });
      throw new HttpError(403, "FORBIDDEN", "insufficient security clearance for this file's classification");
    }
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
}
