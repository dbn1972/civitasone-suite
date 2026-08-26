import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import {
  BudgetSummaryListSchema,
  SanctionSummaryListSchema,
  SanctionDetailSchema,
  FinanceDemandSummaryListSchema,
  FinanceSchemeSummaryListSchema,
  FinanceSchemeSummarySchema,
} from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { createBudgetBody, reappropriateBody, createSanctionBody, budgetQueryParams, idParam, updateHeadHoABody, rejectSanctionBody, submitReappropriationBody } from "./validators.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
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

  // finance_demands table + FinanceDemandSummarySchema both already existed;
  // this route was simply never registered, so the frontend's call to
  // /v1/finance/budgets/demand-grants fell through to GET /v1/finance/budgets/:id
  // below (Fastify prioritises a static path over a param route once it
  // exists, so registration order relative to that route doesn't matter) and
  // 400'd trying to parse "demand-grants" as a UUID.
  app.get("/v1/finance/budgets/demand-grants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listDemandsByTenant(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, FinanceDemandSummaryListSchema, rows.map((r) => ({
      id: r.id, demandNo: r.demandNo, service: r.service,
      amountMinor: r.amountMinor.toString(), currency: r.currency, class: r.class, status: r.status,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
    })));
  });

  // finance_schemes table + FinanceSchemeSummarySchema both already existed;
  // no route anywhere ever exposed them (scheme-tracking list + detail page).
  app.get("/v1/finance/schemes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listSchemesByTenant(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, FinanceSchemeSummaryListSchema, rows.map((r) => ({
      id: r.id, code: r.code, name: r.name,
      outlayMinor: r.outlayMinor.toString(), utilisedMinor: r.utilisedMinor.toString(),
      currency: r.currency, funding: r.funding, status: r.status,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
    })));
  });

  app.get("/v1/finance/schemes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const r = await repo.findSchemeByIdAndTenant(id, ctx.tenantId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "scheme not found");
    sendValidated(reply, FinanceSchemeSummarySchema, {
      id: r.id, code: r.code, name: r.name,
      outlayMinor: r.outlayMinor.toString(), utilisedMinor: r.utilisedMinor.toString(),
      currency: r.currency, funding: r.funding, status: r.status,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
    });
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
      return sendValidated(reply, BudgetSummaryListSchema, await queries.listBudgetSummaries(ctx.tenantId, lq.limit, lq.offset));
    }
    const budget = await queries.getBudget(ctx.tenantId, q.headId, q.fy);
    if (!budget) throw new HttpError(404, "NOT_FOUND", "budget not found");
    return reply.send(budget);
  });

  app.get("/v1/finance/sanctions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, SanctionSummaryListSchema, await queries.listSanctionSummaries(ctx.tenantId, q.limit, q.offset));
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

  app.post("/v1/finance/sanctions", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
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

  // R11 (maker-checker) — a checker approves a pending sanction. Restricted to
  // finance_admin/super_admin; the SoD guard (approver ≠ creator) is enforced
  // in the consumer transaction. Makes single-officer self-sanction impossible.
  app.patch("/v1/finance/sanctions/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["finance_admin", "super_admin"]);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveSanction(ctx, id));
  });

  // H1 — submit a sanction to eOffice for administrative approval. The eFile is
  // raised via the eOffice integration; the decision returns on
  // finance.sanction.file_decided and moves the sanction to approved/cancelled.
  app.post("/v1/finance/sanctions/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitSanctionForApproval(ctx, id));
  });

  // Submit a budget re-appropriation to eOffice for administrative approval.
  // Creates the re-appropriation request (status pending_approval); `:id` is the
  // request id / eFile refId. The decision returns on
  // finance.reappropriation.file_decided and, on approval, applies the change to
  // the target budget's reMinor (see reappropriation-eoffice-consumer).
  app.post("/v1/finance/reappropriations/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitReappropriationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitReappropriationForApproval(ctx, id, body));
  });


  // ── Budget heads (accounts) CRUD ─────────────────────────────────────────────
  // GET /v1/finance/accounts/:id — get a single budget head by UUID
  app.get("/v1/finance/accounts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const head = await repo.findHeadByIdAndTenant(id, ctx.tenantId);
    if (!head) throw new HttpError(404, "NOT_FOUND", "budget head not found");
    return reply.send({
      id: head.id, code: head.code, hoaCode: head.hoaCode ?? null,
      name: head.name, level: head.level, classification: head.classification,
    });
  });

  // POST /v1/finance/accounts — create a budget head (major/minor/sub-minor)
  app.post("/v1/finance/accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = z.object({
      code:           z.string().min(1).max(20),
      name:           z.string().min(2).max(200),
      level:          z.number().int().min(0).max(2),   // 0=major 1=minor 2=sub-minor
      hoaCode:        z.string().length(18).optional(),
      classification: z.enum(["asset", "liability", "equity", "income", "expense"]).optional(),
    }).parse(req.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertHead(tx, {
        id, tenantId: ctx.tenantId,
        code: body.code, name: body.name, level: body.level,
        hoaCode: body.hoaCode ?? null, classification: body.classification ?? null,
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
    });
    return reply.code(201).send({ id, code: body.code, name: body.name, level: body.level, status: "created" });
  });

  // PATCH /v1/finance/accounts/:id — update head name / classification
  app.patch("/v1/finance/accounts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      name:           z.string().min(2).max(200).optional(),
      classification: z.enum(["asset", "liability", "equity", "income", "expense"]).optional(),
    }).parse(req.body);
    const head = await repo.findHeadByIdAndTenant(id, ctx.tenantId);
    if (!head) throw new HttpError(404, "NOT_FOUND", "budget head not found");
    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.name) patch.name = body.name;
    if (body.classification) patch.classification = body.classification;
    await db.transaction(async (tx) => {
      await repo.updateHead(tx, id, patch as Parameters<typeof repo.updateHead>[2]);
    });
    return reply.send({ id, status: "updated" });
  });

  // ── Budget estimates ─────────────────────────────────────────────────────────
  // GET /v1/finance/budgets/:id — get a specific budget estimate by UUID
  app.get("/v1/finance/budgets/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const budget = await repo.findBudgetById(id);
    if (!budget || budget.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "budget not found");
    return reply.send({
      id: budget.id, headId: budget.headId, fy: budget.fy,
      beMinor: budget.beMinor.toString(),
      reMinor: budget.reMinor.toString(),
      allocatedMinor: budget.allocatedMinor.toString(),
      utilisedMinor: budget.utilisedMinor.toString(),
      balanceMinor: (budget.allocatedMinor - budget.utilisedMinor).toString(),
      currency: budget.currency,
    });
  });

  // ── Balance enquiry ──────────────────────────────────────────────────────────
  // GET /v1/finance/balance?headId=X&fy=Y — remaining available balance by head and FY
  app.get("/v1/finance/balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({
      headId: z.string().uuid(),
      fy:     z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(req.query);
    const budget = await queries.getBudget(ctx.tenantId, q.headId, q.fy);
    if (!budget) throw new HttpError(404, "NOT_FOUND", "no budget for this head/FY");
    const allocated = budget.allocatedMinor ?? 0n;
    const utilised  = budget.utilisedMinor  ?? 0n;
    return reply.send({
      headId: q.headId, fy: q.fy,
      allocatedMinor: allocated.toString(),
      utilisedMinor:  utilised.toString(),
      balanceMinor:   (allocated - utilised).toString(),
      balancePct:     allocated > 0n ? Number((allocated - utilised) * 10000n / allocated) / 100 : 0,
      currency: budget.currency,
    });
  });

  app.setErrorHandler(financeErrorHandler);
}
