import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { hrmsContractConfig } from "./schema.js";
import { DomainError, daysUntilExpiry } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import {
  createContractBody,
  activateContractBody,
  initiateRenewalBody,
  bulkRenewalBody,
  terminateContractBody,
  updateConfigBody,
  listContractsQuery,
  listRenewalsQuery,
  idParam,
  employeeIdParam,
} from "./validators.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager"];

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  // ─── Task 9.1 — Contract CRUD ───────────────────────────────────────────────

  app.post("/v1/hrms/contracts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createContractBody.parse(req.body);
    const result = await commands.createContract(ctx, body);
    return reply.code(202).send(result);
  });

  app.post("/v1/hrms/contracts/:id/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = activateContractBody.parse(req.body);
    const result = await commands.activateContract(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.get("/v1/hrms/contracts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const query = listContractsQuery.parse(req.query);
    const filters: { employeeId?: string; status?: string } = {};
    if (query.employeeId) filters.employeeId = query.employeeId;
    if (query.status) filters.status = query.status;
    const result = await repo.listContracts(ctx.tenantId, filters, { limit: query.limit, offset: query.offset });
    return reply.send(result);
  });

  app.get("/v1/hrms/contracts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const contract = await repo.getContractById(ctx.tenantId, id);
    if (!contract) throw new HttpError(404, "CONTRACT_NOT_FOUND", "contract not found");
    return reply.send({ data: contract });
  });

  app.get("/v1/hrms/contracts/employee/:employeeId/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { employeeId } = employeeIdParam.parse(req.params);
    const history = await repo.getContractHistory(ctx.tenantId, employeeId);
    return reply.send({ data: history });
  });

  app.post("/v1/hrms/contracts/:id/terminate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = terminateContractBody.parse(req.body);
    const result = await commands.terminateContract(ctx, id, body);
    return reply.code(202).send(result);
  });

  // ─── Task 9.2 — Renewal and Bulk ───────────────────────────────────────────

  app.post("/v1/hrms/contracts/:id/renew", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = initiateRenewalBody.parse(req.body);

    // Check contract exists
    const contract = await repo.getContractById(ctx.tenantId, id);
    if (!contract) throw new HttpError(404, "CONTRACT_NOT_FOUND", "contract not found");

    // Check status valid for renewal (must be active or expiring)
    if (contract.status !== "active" && contract.status !== "expiring") {
      throw new HttpError(422, "INVALID_CONTRACT_STATUS", `cannot renew contract in status '${contract.status}'; must be active or expiring`);
    }

    // Check no pending renewal
    const pending = await repo.getPendingRenewalForContract(ctx.tenantId, id);
    if (pending) {
      throw new HttpError(409, "RENEWAL_IN_PROGRESS", "a pending renewal already exists for this contract");
    }

    const result = await commands.initiateRenewal(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.post("/v1/hrms/contracts/bulk-renew", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = bulkRenewalBody.parse(req.body);
    const result = await commands.bulkRenewal(ctx, body);
    return reply.code(202).send(result);
  });

  app.get("/v1/hrms/contracts/renewals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const query = listRenewalsQuery.parse(req.query);
    const filters: { contractId?: string; employeeId?: string; status?: string } = {};
    if (query.contractId) filters.contractId = query.contractId;
    if (query.employeeId) filters.employeeId = query.employeeId;
    if (query.status) filters.status = query.status;
    const result = await repo.listRenewals(ctx.tenantId, filters, { limit: query.limit, offset: query.offset });
    return reply.send(result);
  });

  app.get("/v1/hrms/contracts/renewals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const renewal = await repo.getRenewalById(ctx.tenantId, id);
    if (!renewal) throw new HttpError(404, "RENEWAL_NOT_FOUND", "renewal not found");
    return reply.send({ data: renewal });
  });

  // ─── Task 9.3 — Dashboard and Config ───────────────────────────────────────

  app.get("/v1/hrms/contracts/dashboard/expiring", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const contracts = await repo.getExpiringContractsDashboard(ctx.tenantId);
    const asOf = new Date().toISOString().slice(0, 10);
    const enriched = (contracts ?? []).map((c) => ({
      ...c,
      daysRemaining: daysUntilExpiry(c.endDate, asOf),
      renewalStatus: c.status === "expiring" ? "pending" : "not_started",
    }));
    return reply.send({ data: enriched });
  });

  app.get("/v1/hrms/contracts/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const config = await repo.getContractConfig(ctx.tenantId);
    return reply.send({ data: config });
  });

  app.patch("/v1/hrms/contracts/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = updateConfigBody.parse(req.body);

    // Build insert/update payloads explicitly to satisfy exactOptionalPropertyTypes
    const insertValues: Record<string, unknown> = { tenantId: ctx.tenantId, updatedAt: new Date() };
    const updateSet: Record<string, unknown> = { updatedAt: new Date(), version: sql`${hrmsContractConfig.version} + 1` };
    if (body.reminderMilestones !== undefined) {
      insertValues.reminderMilestones = body.reminderMilestones;
      updateSet.reminderMilestones = body.reminderMilestones;
    }
    if (body.approvalChain !== undefined) {
      insertValues.approvalChain = body.approvalChain;
      updateSet.approvalChain = body.approvalChain;
    }
    if (body.autoSeparationEnabled !== undefined) {
      insertValues.autoSeparationEnabled = body.autoSeparationEnabled;
      updateSet.autoSeparationEnabled = body.autoSeparationEnabled;
    }
    if (body.schedulerTimeUtc !== undefined) {
      insertValues.schedulerTimeUtc = body.schedulerTimeUtc;
      updateSet.schedulerTimeUtc = body.schedulerTimeUtc;
    }

    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .insert(hrmsContractConfig)
        .values(insertValues as typeof hrmsContractConfig.$inferInsert)
        .onConflictDoUpdate({
          target: hrmsContractConfig.tenantId,
          set: updateSet,
        })
        .returning();
      return updated[0] ?? null;
    });

    // Invalidate cached config
    await cache.invalidate(`hrms:${ctx.tenantId}:contract:config`);
    return reply.send({ data: result });
  });

  // ─── Error Handler ──────────────────────────────────────────────────────────

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    }
    if (err instanceof DomainError) {
      const domainErr = err as DomainError;
      return reply.code(422).send({ code: domainErr.code, message: domainErr.message, details: domainErr.details, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
