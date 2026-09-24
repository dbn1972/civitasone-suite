import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { TenderSummaryListSchema, TenderDetailSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { getCommandOutcome } from "../../shared/outbox.js";
import { db } from "../../shared/db.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";
import { createTenderBody, submitBidBody, techEvaluateBody, awardTenderBody, idParam } from "./validators.js";

const commandIdParam = z.object({ commandId: z.string().uuid() });

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];

export async function tenderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/tenders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, TenderSummaryListSchema, await queries.listTenders(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/procurement/tenders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getTenderDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "tender not found");
    sendValidated(reply, TenderDetailSchema, detail);
  });

  // Two-bid evaluation view — proves the sealing property (financial withheld
  // until the envelope is opened).
  app.get("/v1/procurement/tenders/:id/evaluation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const view = await queries.getEvaluationView(id, ctx.tenantId);
    if (!view) throw new HttpError(404, "NOT_FOUND", "tender not found");
    return reply.send(view);
  });

  // ── Competitive lifecycle commands ──────────────────────────────────────
  app.post("/v1/procurement/tenders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createTenderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTender(ctx, body));
  });

  app.post("/v1/procurement/tenders/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.publishTender(ctx, id));
  });

  app.post("/v1/procurement/tenders/:id/bids", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitBidBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitBid(ctx, id, body));
  });

  // G-ASYNC-1: poll a command's eventual outcome using the `id` any of this
  // module's 202 responses returned (it is the underlying queue messageId —
  // see @civitasone/outbox's commandResults doc comment). Answers
  // docs/API-GUIDE.md §3.1's documented "poll the resource... or use the
  // returned id to check status" contract, which nothing previously
  // implemented for this (or, before this change, any) module: a bid
  // rejected async as BIDDING_CLOSED or DUPLICATE_BID (tender/consumer.ts)
  // was previously undetectable by the caller — the 202 already went out and
  // the eventual rejection had no caller-visible trace. Wired for
  // tenderBidSubmit today (see tender/consumer.ts's recordTenderCommandOutcome);
  // this module's other five commands are equally trivial to wire the same
  // way and are natural fast-follows, not done here to keep this change small.
  app.get("/v1/procurement/tenders/commands/:commandId/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { commandId } = commandIdParam.parse(req.params);
    // _inbox.command_results deliberately has NO row-level security (see its
    // doc comment in @civitasone/outbox — the cross-tenant purge loop needs
    // to delete old rows with no app.tenant_id GUC set, the same reason
    // _outbox.messages had FORCE RLS dropped fleet-wide). ctx.tenantId here
    // is therefore the ONLY thing enforcing tenant isolation on this read —
    // getCommandOutcome filters on it explicitly, not via RLS.
    const outcome = await getCommandOutcome(db, ctx.tenantId, commandId);
    if (!outcome) return reply.send({ commandId, status: "processing" });
    return reply.send({ commandId, status: outcome.status, reason: outcome.reason, occurredAt: outcome.occurredAt });
  });

  app.post("/v1/procurement/tenders/:id/technical-evaluation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = techEvaluateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.technicalEvaluate(ctx, id, body));
  });

  app.post("/v1/procurement/tenders/:id/open-financial", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.openFinancials(ctx, id));
  });

  app.post("/v1/procurement/tenders/:id/award", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = awardTenderBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.awardTender(ctx, id, body));
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
