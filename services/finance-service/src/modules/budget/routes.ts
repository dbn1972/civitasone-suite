import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import {
  BudgetSummaryListSchema,
  SanctionSummaryListSchema,
  SanctionDetailSchema,
} from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createBudgetBody, reappropriateBody, createSanctionBody, budgetQueryParams, idParam, updateHeadHoABody, rejectSanctionBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES  = [...FINANCE_ROLES, "audit_officer", "procurement_officer"];

export async function budgetRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/budgets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createBudgetBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBudget(ctx, body));
  });

  app.patch("/v1/finance/budgets/:id/re", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reappropriateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reappropriateBudget(ctx, id, body));
  });

  app.get("/v1/finance/accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const accounts = await queries.listAccounts(ctx.tenantId, q.limit);
    return reply.send({ data: accounts, pagination: { hasMore: accounts.length === q.limit, pageSize: q.limit } });
  });

  app.patch("/v1/finance/accounts/:id/hoa", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateHeadHoABody.parse(req.body);
    await commands.updateHeadHoA(ctx, id, body);
    return reply.send({ id, hoaCode: body.hoaCode, status: "updated" });
  });

  app.get("/v1/finance/budgets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = budgetQueryParams.parse(req.query);
    if (!q.headId || !q.fy) {
      const lq = listQuerySchema.parse(req.query);
      return sendValidated(reply, BudgetSummaryListSchema, await queries.listBudgetSummaries(ctx.tenantId, lq.limit));
    }
    const budget = await queries.getBudget(ctx.tenantId, q.headId, q.fy);
    if (!budget) throw new HttpError(404, "NOT_FOUND", "budget not found");
    return reply.send(budget);
  });

  app.get("/v1/finance/sanctions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, SanctionSummaryListSchema, await queries.listSanctionSummaries(ctx.tenantId, q.limit));
  });

  app.get("/v1/finance/sanctions/:id/available", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const result = await queries.getSanctionAvailable(id, ctx.tenantId);
    if (!result) throw new HttpError(404, "NOT_FOUND", "sanction not found");
    return reply.send({ ...result, available: result.available.toString() });
  });

  app.get("/v1/finance/sanctions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getSanctionDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "sanction not found");
    sendValidated(reply, SanctionDetailSchema, detail);
  });

  app.post("/v1/finance/sanctions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createSanctionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSanction(ctx, body));
  });

  app.patch("/v1/finance/sanctions/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectSanctionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectSanction(ctx, id, body));
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
