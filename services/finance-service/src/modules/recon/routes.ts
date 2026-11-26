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
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { DomainError } from "../payments/domain.js";
import { decideWriteOff, assertMayDeclineWriteOff, WRITEOFF_SECOND_APPROVER_ROLES } from "./writeoff-policy.js";
import * as repo from "./repo.js";
import { listProviders, getProvider } from "./providers.js";
import * as commands from "./commands.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

const runBody = z.object({
  provider: z.string().min(1).max(64),
  params: z.record(z.unknown()).optional(),
});

/** Resolve / write-off close a break, so they must carry a justification (GAP-FINANCE-RECONCILIATION-01). */
export const NOTE_MIN = 10;
export const NOTE_MAX = 1000;

export const actionBody = z
  .object({
    // decline_write_off (C30): withdraw / refuse a write-off that is waiting for its second approver.
    action: z.enum(["investigate", "resolve", "write_off", "reopen", "decline_write_off"]),
    // Trimmed before the length checks so whitespace cannot satisfy the minimum.
    note: z.string().trim().max(NOTE_MAX).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.action === "resolve" || v.action === "write_off" || v.action === "decline_write_off") && (v.note ?? "").length < NOTE_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: `a note of at least ${NOTE_MIN} characters is required to ${v.action === "resolve" ? "resolve" : v.action === "decline_write_off" ? "decline the write-off of" : "write off"} an exception`,
      });
    }
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
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const { status, runId, limit, offset } = q;
    const allBreaks = await repo.listBreaks(ctx.tenantId, { status, runId }, limit + offset);
    const breaks = allBreaks.slice(offset, offset + limit);
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
      if (body.action === "decline_write_off") {
        assertMayDeclineWriteOff({ requestedBy: existing.writeoffRequestedBy, actorId: ctx.actorId, actorRoles: ctx.roles });
      } else {
        applyExceptionAction(existing.status as ExceptionStatus, body.action as ExceptionAction);
      }
      // C30: a write-off above the tenant threshold needs a second approver. Decided here for an immediate 409/403 and again,
      // authoritatively, inside the consumer's transaction.
      if (body.action === "write_off") {
        const { thresholdMinor } = await repo.getWriteoffThreshold(ctx.tenantId);
        decideWriteOff({
          deltaMinor: existing.deltaMinor, thresholdMinor, requestedBy: existing.writeoffRequestedBy,
          actorId: ctx.actorId, actorRoles: ctx.roles,
        });
      }
    } catch (err) {
      if (err instanceof ExceptionWorkflowError) throw new HttpError(409, err.code, err.message);
      if (err instanceof DomainError) {
        throw new HttpError(err.code === "WRITEOFF_APPROVER_ROLE_REQUIRED" ? 403 : 409, err.code, err.message);
      }
      throw err;
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.applyExceptionActionCmd(ctx, id, body, ctx.roles),
    );
  });

  // C30: the per-tenant write-off second-approval threshold. Readable by finance readers; set by finance_admin / super_admin only.
  app.get("/v1/finance/recon/writeoff-policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { thresholdMinor, isDefault } = await repo.getWriteoffThreshold(ctx.tenantId);
    return reply.send({ data: { writeoffSecondApprovalMinor: thresholdMinor.toString(), isPlatformDefault: isDefault, approverRoles: [...WRITEOFF_SECOND_APPROVER_ROLES] } });
  });

  app.put("/v1/finance/recon/writeoff-policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...WRITEOFF_SECOND_APPROVER_ROLES]);
    const body = z.object({ writeoffSecondApprovalMinor: z.string().regex(/^\d{1,15}$/, "paise as a whole number") }).parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setWriteoffPolicyCmd(ctx, BigInt(body.writeoffSecondApprovalMinor)));
  });

  app.setErrorHandler(financeErrorHandler);
}