import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { zodFieldErrors } from "@civitasone/schemas/http";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { idempotentCreate, isLikelyDuplicate, type DuplicateWarning } from "../../shared/idempotency.js";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createIndentBody, approveIndentBody, rejectIndentBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { searchQuerySchema } from "../../shared/search.js";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];

/** 202 for an indent create, with an optional duplicate warning (TE-09). */
const indentAcceptedSchema = acceptedResponseSchema.extend({
  warnings: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
});

export async function indentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/indents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createIndentBody.parse(req.body);
    // UAT T-EDGE TE-09: the same X-Idempotency-Key + body creates ONE indent and the
    // retry gets the first answer back; the same key with another body is a 422. Without a
    // key, the same maker sending the same purpose and items in the same minute still gets
    // the indent (a genuine repeat is allowed) but with a POSSIBLE_DUPLICATE warning.
    const accepted = await idempotentCreate(ctx, "procurement.indent.create", body, async () => {
      const duplicate = await isLikelyDuplicate(ctx, "procurement.indent.create", {
        purpose: body.purpose.toLowerCase(), department: body.department.toLowerCase(),
        items: body.items.map((i) => [i.itemCode, i.quantity, i.unitPriceMinor]),
      });
      const warnings: DuplicateWarning[] = duplicate
        ? [{ code: "POSSIBLE_DUPLICATE", message: "you submitted an indent with the same purpose and items a moment ago; check the indent list before submitting again" }]
        : [];
      return { ...(await commands.createIndent(ctx, body)), ...(warnings.length ? { warnings } : {}) };
    });
    return sendAccepted(reply, indentAcceptedSchema, accepted);
  });

  app.patch("/v1/procurement/indents/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    if (!ctx.roles.includes("super_admin")) {
      throw new HttpError(403, "WORKFLOW_REQUIRED", "Approve indent via workflow task inbox (/procurement/approvals)");
    }
    const { id } = idParam.parse(req.params);
    const body = approveIndentBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveIndent(ctx, id, body));
  });

  app.patch("/v1/procurement/indents/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectIndentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectIndent(ctx, id, body));
  });

  app.get("/v1/procurement/indents/tender-required", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await queries.listTenderRequiredIndents(ctx.tenantId);
    return reply.send({ data: rows.map((r) => ({ ...r, totalMinor: String(r.totalMinor) })) });
  });

  app.get("/v1/procurement/indents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    // GAP-PROCUREMENT-RFQ-NEW-01: optional status filter so a caller (the RFQ
    // create form) can ask for only 'approved' indents — an RFQ must be raised
    // against an approved indent, never a draft/rejected one. Validated against
    // the known indent statuses; an unknown value yields an empty list rather
    // than silently returning everything. GAP-PROCUREMENT-DASHBOARD-02: the
    // value may also be a comma-separated set (`draft,pending`), matched with an
    // SQL IN so limit/offset page over exactly those rows.
    const statusRaw = typeof (req.query as Record<string, unknown>).status === "string"
      ? ((req.query as Record<string, string>).status)
      : undefined;
    // Every role that passes requireRole(READER_ROLES) above (procurement
    // officers/admins, audit, finance) is a tenant-wide reader, so the list is
    // tenant-wide. (repo.findIndentsByTenantAndDepartment exists for a future
    // narrower reader role; no current caller reaches it.) The status filter is
    // applied in SQL so limit/offset page over matching rows only.
    const { q: search } = searchQuerySchema.parse(req.query);
    const list = await queries.listIndents(ctx.tenantId, q.limit, q.offset, undefined, statusRaw, search);
    return reply.send(list);
  });

  // D4c #18 (GAP-PROCUREMENT-INDENTS-01): true total + per-status counts for the
  // list page (same shape idea as vendors/summary). Registered before :id so
  // "summary" is not read as an id.
  app.get("/v1/procurement/indents/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const statusRaw = typeof (req.query as Record<string, unknown>).status === "string"
      ? ((req.query as Record<string, string>).status)
      : undefined;
    const { q: search } = searchQuerySchema.parse(req.query);
    return reply.send({ data: await queries.indentSummaryCounts(ctx.tenantId, statusRaw, search) });
  });

  app.get("/v1/procurement/indents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const indent = await queries.getIndent(id, ctx.tenantId);
    if (!indent) throw new HttpError(404, "NOT_FOUND", "indent not found");
    return reply.send(indent);
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: zodFieldErrors(err.issues) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false, ...(err.fieldErrors?.length ? { fieldErrors: err.fieldErrors } : {}) });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
