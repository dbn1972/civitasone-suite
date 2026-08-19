import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { GLEntrySummaryListSchema, FinancialStatementSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { postJournalBody, ledgerQueryParams, reverseParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const FINANCE_ADMIN_ROLES = ["finance_admin", "super_admin"];
const READER_ROLES  = [...FINANCE_ROLES, "audit_officer"];

export async function glRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/journals", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ADMIN_ROLES);
    const body = postJournalBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.postJournal(ctx, body));
  });

  app.post("/v1/finance/journals/:id/reverse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = reverseParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reverseJournal(ctx, id));
  });

  app.get("/v1/finance/ledger", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const params = ledgerQueryParams.parse(req.query);
    const lines = await queries.getLedger(ctx.tenantId, params);
    return reply.send({ data: lines, pagination: { hasMore: lines.length === params.limit, pageSize: params.limit } });
  });

  app.get("/v1/finance/journals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, GLEntrySummaryListSchema, await queries.listJournalEntries(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/finance/statements/trial-balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await queries.getTrialBalance(ctx.tenantId);
    return reply.send({ data: rows });
  });

  app.get("/v1/finance/statements/trial-balance/balanced", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = req.query as { period?: string };
    const period = typeof q.period === "string" && /^\d{4}-\d{2}$/.test(q.period) ? q.period : undefined;
    const result = await queries.getTrialBalanceBalanced(ctx.tenantId, period);
    return reply.send(result);
  });

  app.get("/v1/finance/statements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    sendValidated(reply, FinancialStatementSummaryListSchema, await queries.listFinancialStatements(ctx.tenantId));
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
