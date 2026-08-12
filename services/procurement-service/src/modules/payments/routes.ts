import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createAdvanceBody, createDebitNoteBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin", "finance_officer"];
const READER_ROLES = [...PROC_ROLES, "audit_officer"];

function serAdv(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, amountMinor: String(r.amountMinor), recoveryMinor: String(r.recoveryMinor), type: "advance" };
}
function serDN(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, amountMinor: String(r.amountMinor), type: "debit_note" };
}

const listQuerySchema = z.object({
  poId:     z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  status:   z.string().optional(),
  limit:    z.coerce.number().int().min(1).max(200).default(50),
  offset:   z.coerce.number().int().min(0).default(0),
});

export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/advances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createAdvanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAdvance(ctx, body));
  });

  app.post("/v1/procurement/debit-notes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createDebitNoteBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDebitNote(ctx, body));
  });

  app.get("/v1/procurement/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const advOpts: { poRef?: string; vendorId?: string; status?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.poId) advOpts.poRef = q.poId;
    if (q.vendorId) advOpts.vendorId = q.vendorId;
    if (q.status) advOpts.status = q.status;
    const dnOpts: { grnRef?: string; vendorId?: string; status?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.vendorId) dnOpts.vendorId = q.vendorId;
    if (q.status) dnOpts.status = q.status;
    const [advances, debitNotes] = await Promise.all([
      repo.listAdvancesByTenant(ctx.tenantId, advOpts),
      repo.listDebitNotesByTenant(ctx.tenantId, dnOpts),
    ]);
    const data = [
      ...advances.map((a) => serAdv(a as unknown as Record<string, unknown>)),
      ...debitNotes.map((d) => serDN(d as unknown as Record<string, unknown>)),
    ];
    return reply.send({ data, total: data.length });
  });

  app.get("/v1/procurement/payments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const advance = await repo.findAdvanceById(id, ctx.tenantId);
    if (advance) return reply.send({ data: serAdv(advance as unknown as Record<string, unknown>) });
    const debitNote = await repo.findDebitNoteById(id, ctx.tenantId);
    if (debitNote) return reply.send({ data: serDN(debitNote as unknown as Record<string, unknown>) });
    throw new HttpError(404, "NOT_FOUND", "payment not found");
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
