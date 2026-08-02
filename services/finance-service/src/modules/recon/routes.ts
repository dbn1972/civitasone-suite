/**
 * CAP-059 — reconciliation routes (finance-service).
 *
 * Mutations are CQRS (queue.publish → 202). Reads remain synchronous.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import {
  applyExceptionAction,
  ExceptionWorkflowError,
  type ExceptionStatus,
  type ExceptionAction,
} from "@civitasone/reconciliation";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { listProviders, getProvider } from "./providers.js";
import * as commands from "./commands.js";

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
    if (!getProvider(body.provider)) {
      throw new HttpError(400, "UNKNOWN_PROVIDER", `no reconciliation provider '${body.provider}'`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.startReconRun(ctx, body));
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

    const existing = await repo.getBreak(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "exception not found");
    // Validate transition before enqueue (preserve 409 for illegal moves).
    try {
      applyExceptionAction(existing.status as ExceptionStatus, body.action as ExceptionAction);
    } catch (err) {
      if (err instanceof ExceptionWorkflowError) throw new HttpError(409, err.code, err.message);
      throw err;
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.applyExceptionActionCmd(ctx, id, body),
    );
  });
}
