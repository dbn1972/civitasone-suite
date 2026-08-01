import { sendAccepted } from "@civitasone/schemas/validate";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createContractBody, amendContractBody, approveContractBody, activateContractBody,
  closeContractBody, terminateContractBody, idParam,
  markMilestoneLateBody, completeMilestoneBody, milestoneIdParam,
  registerBondBody, transitionBondBody, bondIdParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { scopedRead } from "../../shared/db.js";
import { contractMilestones } from "./schema.js";
import { eq, and } from "drizzle-orm";
import * as repo from "./repo.js";

const CONTRACT_ROLES = ["procurement_admin", "finance_admin", "super_admin"];
const READER_ROLES   = [...CONTRACT_ROLES, "audit_officer", "procurement_officer"];

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

  app.post("/v1/contract/contracts/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitContractForApproval(ctx, id));
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

  // ── Milestone management (queue-first mutations) ─────────────────────────
  app.get("/v1/contract/contracts/:id/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx
      .select()
      .from(contractMilestones)
      .where(and(eq(contractMilestones.contractId, id), eq(contractMilestones.tenantId, ctx.tenantId))));
    return reply.send({ data: rows });
  });

  app.patch("/v1/contract/contracts/:id/milestones/:milestoneId/late", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id, milestoneId } = milestoneIdParam.parse(req.params);
    const body = markMilestoneLateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.markMilestoneLate(ctx, id, milestoneId, body));
  });

  app.patch("/v1/contract/contracts/:id/milestones/:milestoneId/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id, milestoneId } = milestoneIdParam.parse(req.params);
    const body = completeMilestoneBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeMilestone(ctx, id, milestoneId, body));
  });

  // ── Performance bonds / bank guarantees ──────────────────────────────────
  app.get("/v1/contract/contracts/:id/bonds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await repo.listBonds(id, ctx.tenantId);
    return reply.send({ data: rows });
  });

  app.post("/v1/contract/contracts/:id/bonds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = registerBondBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.registerPerformanceBond(ctx, id, body));
  });

  app.post("/v1/contract/contracts/:id/bonds/:bondId/transition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id, bondId } = bondIdParam.parse(req.params);
    const body = transitionBondBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.transitionPerformanceBond(ctx, id, bondId, body));
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
