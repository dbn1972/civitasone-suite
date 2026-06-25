import { sendAccepted } from "@civitasone/schemas/validate";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createContractBody, amendContractBody, approveContractBody, activateContractBody,
  closeContractBody, terminateContractBody, idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { db } from "../../shared/db.js";
import { contractMilestones, contractContracts } from "./schema.js";
import { eq, and } from "drizzle-orm";

const CONTRACT_ROLES = ["procurement_admin", "finance_admin", "super_admin"];
const READER_ROLES   = [...CONTRACT_ROLES, "audit_officer", "procurement_officer"];

const milestoneIdParam = z.object({ id: z.string().uuid(), milestoneId: z.string().uuid() });

const markLateBody = z.object({
  achievedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "achievedDate must be YYYY-MM-DD"),
  notes: z.string().max(500).optional(),
});

const expiringQuery = z.object({
  days:  z.coerce.number().int().positive().max(365).default(30),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  // ── Lifecycle: create → approve → activate → close/terminate ──────────────
  app.post("/v1/contract/contracts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const body = createContractBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createContract(ctx, body));
  });

  app.post("/v1/contract/contracts/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveContractBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveContract(ctx, id, body));
  });

  app.post("/v1/contract/contracts/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = activateContractBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.activateContract(ctx, id, body));
  });

  app.post("/v1/contract/contracts/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeContractBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeContract(ctx, id, body));
  });

  app.post("/v1/contract/contracts/:id/terminate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = terminateContractBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.terminateContract(ctx, id, body));
  });

  app.patch("/v1/contract/contracts/:id/amend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = amendContractBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.amendContract(ctx, id, body));
  });

  // ── Read models ──────────────────────────────────────────────────────────
  app.get("/v1/contract/contracts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const contracts = await queries.listContracts(ctx.tenantId, q.limit);
    return reply.send({ data: contracts, pagination: { hasMore: contracts.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/contract/contracts/active", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await queries.listActive(ctx.tenantId, q.limit);
    return reply.send({ data: rows, pagination: { hasMore: rows.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/contract/contracts/expiring", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = expiringQuery.parse(req.query);
    const rows = await queries.listExpiring(ctx.tenantId, q.days, q.limit);
    return reply.send({ data: rows, meta: { withinDays: q.days }, pagination: { hasMore: rows.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/contract/contracts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const contract = await queries.getContractDetail(id, ctx.tenantId);
    if (!contract) throw new HttpError(404, "NOT_FOUND", "contract not found");
    return reply.send(contract);
  });

  // ── Milestone management ────────────────────────────────────────────────
  app.get("/v1/contract/contracts/:id/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await db
      .select()
      .from(contractMilestones)
      .where(and(eq(contractMilestones.contractId, id), eq(contractMilestones.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  /**
   * Mark a milestone as late with achieved date — auto-calculates penalty
   * from contract slaTerms.penaltyRatePct (% per week) and deducts from milestone amount.
   */
  app.patch("/v1/contract/contracts/:id/milestones/:milestoneId/late", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id, milestoneId } = milestoneIdParam.parse(req.params);
    const body = markLateBody.parse(req.body);

    const [contract] = await db
      .select()
      .from(contractContracts)
      .where(and(eq(contractContracts.id, id), eq(contractContracts.tenantId, ctx.tenantId)))
      .limit(1);
    if (!contract) throw new HttpError(404, "NOT_FOUND", "contract not found");

    const [milestone] = await db
      .select()
      .from(contractMilestones)
      .where(and(eq(contractMilestones.id, milestoneId), eq(contractMilestones.contractId, id)))
      .limit(1);
    if (!milestone) throw new HttpError(404, "NOT_FOUND", "milestone not found");
    if (milestone.status === "completed") throw new HttpError(409, "ALREADY_COMPLETED", "milestone is already completed");

    const dueDate = new Date(milestone.dueDate);
    const achievedDate = new Date(body.achievedDate);
    const delayMs = achievedDate.getTime() - dueDate.getTime();
    const delayDays = Math.max(0, Math.ceil(delayMs / (1000 * 60 * 60 * 24)));
    const delayWeeks = Math.ceil(delayDays / 7);

    const sla = (contract.slaTerms ?? {}) as Record<string, unknown>;
    const penaltyRatePct = typeof sla["penaltyRatePct"] === "number" ? sla["penaltyRatePct"] : 0.5;
    const maxPenaltyPct  = typeof sla["maxPenaltyPct"]  === "number" ? sla["maxPenaltyPct"]  : 10;

    const milestoneAmt = Number(milestone.amountMinor);
    const rawPenaltyPct = delayWeeks * penaltyRatePct;
    const cappedPenaltyPct = Math.min(rawPenaltyPct, maxPenaltyPct);
    const penaltyMinor = Math.round(milestoneAmt * cappedPenaltyPct / 100);
    const netPayableMinor = Math.max(0, milestoneAmt - penaltyMinor);

    const isLate = delayDays > 0;
    const newStatus = isLate ? "completed_late" : "completed";
    await db
      .update(contractMilestones)
      .set({
        status: newStatus,
        achievedDate: body.achievedDate,
        updatedAt: new Date(),
        updatedBy: ctx.actorId,
        version: (milestone.version ?? 1) + 1,
      } as any)
      .where(eq(contractMilestones.id, milestoneId));

    return reply.send({
      data: {
        milestoneId, contractId: id, status: newStatus,
        dueDate: milestone.dueDate, achievedDate: body.achievedDate,
        delayDays, delayWeeks, penaltyRatePct,
        rawPenaltyPct: Number(rawPenaltyPct.toFixed(2)),
        cappedPenaltyPct: Number(cappedPenaltyPct.toFixed(2)),
        penaltyMinor, milestoneAmountMinor: milestoneAmt, netPayableMinor,
        currency: milestone.currency, notes: body.notes ?? null,
      },
    });
  });

  /** Mark a milestone as completed on time (achieved on or before due date). */
  app.patch("/v1/contract/contracts/:id/milestones/:milestoneId/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id, milestoneId } = milestoneIdParam.parse(req.params);
    const body = z.object({ achievedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);

    const [milestone] = await db
      .select()
      .from(contractMilestones)
      .where(and(eq(contractMilestones.id, milestoneId), eq(contractMilestones.contractId, id)))
      .limit(1);
    if (!milestone) throw new HttpError(404, "NOT_FOUND", "milestone not found");
    if (milestone.status === "completed" || milestone.status === "completed_late") {
      throw new HttpError(409, "ALREADY_COMPLETED", "milestone is already completed");
    }

    await db
      .update(contractMilestones)
      .set({ status: "completed", achievedDate: body.achievedDate, updatedAt: new Date(), updatedBy: ctx.actorId, version: (milestone.version ?? 1) + 1 } as any)
      .where(eq(contractMilestones.id, milestoneId));

    return reply.send({
      data: { milestoneId, contractId: id, status: "completed", achievedDate: body.achievedDate, penaltyMinor: 0, netPayableMinor: Number(milestone.amountMinor) },
    });
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
