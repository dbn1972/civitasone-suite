/**
 * CAP-059 — reconciliation routes (finance-service).
 *
 * GET  /v1/finance/recon/providers            list available source providers
 * POST /v1/finance/recon/runs                 trigger a reconciliation run
 * GET  /v1/finance/recon/runs                 list runs
 * GET  /v1/finance/recon/runs/:id             run + its breaks
 * GET  /v1/finance/recon/exceptions           list breaks (filter: status, runId)
 * POST /v1/finance/recon/exceptions/:id/action  drive a break through its lifecycle
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { applyExceptionAction, ExceptionWorkflowError, type ExceptionStatus, type ExceptionAction } from "@civitasone/reconciliation";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import { listProviders } from "./providers.js";
import { runReconciliation, ReconError } from "./service.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

const runBody = z.object({
  provider: z.string().min(1).max(64),
  params: z.record(z.unknown()).optional(),
});

const actionBody = z.object({
  action: z.enum(["investigate", "resolve", "write_off", "reopen"]),
  note: z.string().max(1000).optional(),
});

export async function reconRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/recon/providers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send({
      data: listProviders().map((p) => ({ key: p.key, sourceSystem: p.sourceSystem, targetSystem: p.targetSystem })),
    });
  });

  app.post("/v1/finance/recon/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = runBody.parse(req.body ?? {});
    try {
      const result = await runReconciliation(ctx, body.provider, body.params ?? {});
      return reply.code(201).send({
        data: {
          runId: result.run.id,
          balanced: result.balanced,
          breakCount: result.breakCount,
          sourceCount: result.run.sourceCount,
          targetCount: result.run.targetCount,
          matchedCount: result.run.matchedCount,
        },
      });
    } catch (err) {
      if (err instanceof ReconError) throw new HttpError(err.status, err.code, err.message);
      throw err;
    }
  });

  app.get("/v1/finance/recon/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const runs = await repo.listRuns(ctx.tenantId, q.limit);
    return reply.send({ data: runs, meta: { total: runs.length } });
  });

  app.get("/v1/finance/recon/runs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const run = await repo.getRun(ctx.tenantId, id);
    if (!run) throw new HttpError(404, "NOT_FOUND", "recon run not found");
    const breaks = await repo.listBreaks(ctx.tenantId, { runId: id }, 1000);
    return reply.send({ data: run, breaks });
  });

  app.get("/v1/finance/recon/exceptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z
      .object({
        status: z.enum(["open", "investigating", "resolved", "written_off"]).optional(),
        runId: z.string().uuid().optional(),
      })
      .parse(req.query);
    const breaks = await repo.listBreaks(ctx.tenantId, q);
    return reply.send({ data: breaks, meta: { total: breaks.length } });
  });

  app.post("/v1/finance/recon/exceptions/:id/action", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = actionBody.parse(req.body);

    const updated = await db.transaction(async (tx) => {
      const existing = await repo.getBreak(ctx.tenantId, id);
      if (!existing) throw new HttpError(404, "NOT_FOUND", "exception not found");
      let next: ExceptionStatus;
      try {
        next = applyExceptionAction(existing.status as ExceptionStatus, body.action as ExceptionAction);
      } catch (err) {
        if (err instanceof ExceptionWorkflowError) throw new HttpError(409, err.code, err.message);
        throw err;
      }
      const resolving = next === "resolved" || next === "written_off";
      return repo.updateBreakStatus(tx, ctx.tenantId, id, {
        status: next,
        resolutionNote: body.note ?? null,
        // Audit who closed the break and when (operational triage, recorded for trail).
        resolvedBy: resolving ? ctx.actorId : null,
        resolvedAt: resolving ? new Date() : null,
      });
    });

    return reply.send({ data: updated });
  });
}
