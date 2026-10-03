import { fetchUserSummaries, actorName } from "../../shared/identity-client.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import * as periodRepo from "./repo.js";
import * as commands from "./commands.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const PERIOD_ADMIN_ROLES = ["finance_admin", "super_admin"];

const periodParam = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM") });

// GAP-FINANCE-PERIOD-CLOSE-01: soft-close, hard-close and reopen all change
// whether the books for a month accept postings, so every transition now
// carries a mandatory stated reason, recorded in the audit event and the
// finance.period.* domain event (period-close/consumer.ts). Previously only
// reopen accepted one (and even that was optional).
const transitionBody = z.object({
  reason: z.string().trim().min(10, "Reason must be at least 10 characters").max(500),
});

export async function isPeriodHardClosed(tenantId: string, period: string): Promise<boolean> {
  return periodRepo.isPeriodHardClosedDb(tenantId, period);
}

export async function getPeriodStatus(tenantId: string, period: string): Promise<string> {
  return periodRepo.getPeriodStatusDb(tenantId, period);
}

export async function periodCloseRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/periods/:period/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { period } = periodParam.parse(req.params);
    const { reason } = transitionBody.parse(req.body ?? {});

    const existing = await periodRepo.findPeriodClose(ctx.tenantId, period);
    if (existing?.status === "hard_close") {
      throw new HttpError(409, "ALREADY_CLOSED", "period is already hard-closed");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.closePeriod(ctx, period, "soft_close", reason));
  });

  // POLICY DECISION (flagged for explicit review, not assumed obviously
  // correct): previously FINANCE_ROLES, so a plain finance_officer could
  // unilaterally hard-close a period even though only the SAME elevated tier
  // (finance_admin/super_admin) could ever reopen it again below — a
  // one-way door a baseline officer could close but not undo. Tied to the
  // same PERIOD_ADMIN_ROLES tier as reopen for consistency. Soft-close above
  // is left at FINANCE_ROLES: it is explicitly reversible by any finance
  // officer re-closing/adjusting, unlike hard-close's period-locking intent.
  app.post("/v1/finance/periods/:period/hard-close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PERIOD_ADMIN_ROLES);
    const { period } = periodParam.parse(req.params);
    const { reason } = transitionBody.parse(req.body ?? {});

    const existing = await periodRepo.findPeriodClose(ctx.tenantId, period);
    if (existing?.status === "hard_close") {
      throw new HttpError(409, "ALREADY_CLOSED", "period is already hard-closed");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.closePeriod(ctx, period, "hard_close", reason));
  });

  app.post("/v1/finance/periods/:period/reopen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PERIOD_ADMIN_ROLES);
    const { period } = periodParam.parse(req.params);
    const body = transitionBody.parse(req.body ?? {});

    const existing = await periodRepo.findPeriodClose(ctx.tenantId, period);
    if (!existing || existing.status === "open") {
      throw new HttpError(409, "NOT_CLOSED", "period is already open");
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.reopenPeriod(ctx, period, body.reason),
    );
  });

  // GAP-FINANCE-PERIOD-CLOSE-02: what is still outstanding in a period
  // before it is locked -- the hard-close dialog shows these counts (with
  // links) instead of only warning that unposted vouchers "will be left
  // stranded". Read-only; counts only, no amounts.
  app.get("/v1/finance/periods/:period/readiness", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { period } = periodParam.parse(req.params);
    const readiness = await periodRepo.getPeriodReadiness(ctx.tenantId, period);
    return reply.send({ data: { period, ...readiness } });
  });

  app.get("/v1/finance/periods", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await periodRepo.listPeriodClose(ctx.tenantId, q.limit);
    // GAP-FINANCE-PERIOD-CLOSE-06: closed_by is an identity user uuid; resolve it to a
    // display name (best-effort, fails open) so the cockpit never has to show a raw id.
    const names = await fetchUserSummaries(ctx.tenantId);
    const page = rows.slice(q.offset, q.offset + q.limit).map((r) => ({ ...r, closedByName: actorName(names, r.closedBy) }));
    return reply.send({ data: page, total: rows.length });
  });

  app.setErrorHandler(financeErrorHandler);
}
