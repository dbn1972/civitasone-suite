/**
 * GAP-PAYROLL-STATUTORY-PT-04: professional-tax slab versions.
 *
 *   GET  /v1/payroll/statutory/pt/versions[?stateCode=]  timeline per state
 *   POST /v1/payroll/statutory/pt/versions               create a new version (202 + request id)
 *   GET  /v1/payroll/statutory/pt/versions/requests/:id  outcome of that command
 *   PATCH .../requests/:id/approve | /reject             a DIFFERENT admin decides (maker != checker)
 *   PUT  /v1/payroll/statutory/pt/settings               the maker-checker switch (OFF needs a 2nd approver)
 *
 * A version effective mid-month applies to that WHOLE month's pay run: the run
 * engine resolves the version in force on the run's period end (last day of the
 * run month).
 *
 * The POST is a command route: zod + read-only guards here, publish, 202; the
 * write (transaction + audit outbox event, guards re-checked under a lock) is
 * pt-versions-consumer.ts. payroll_admin / super_admin only.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { INDIAN_STATE_UT_CODES } from "./state-rules.js";
import {
  buildTimeline, checkNewVersion, createPtVersionBody, findSlabSetProblem, periodEndOf, dayAfter, todayIst,
} from "./pt-versions-domain.js";
import { latestFinalisedRunMonth, listPendingRequests, listVersions, ptMakerCheckerEnabled } from "./pt-versions-repo.js";
import * as commands from "./pt-versions-commands.js";

const PT_ADMIN_ROLES = ["payroll_admin", "super_admin"];
const PT_READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];
const STATES: ReadonlySet<string> = new Set(INDIAN_STATE_UT_CODES);

export async function ptVersionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/statutory/pt/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PT_READER_ROLES);
    const q = z.object({ stateCode: z.string().trim().toUpperCase().min(2).max(4).optional() }).parse(req.query);
    const today = todayIst();
    const { versions, lastFinalisedMonth, pending, makerChecker } = await scopedRead(async (tx) => ({
      versions: await listVersions(tx as never, ctx.tenantId, q.stateCode),
      lastFinalisedMonth: await latestFinalisedRunMonth(tx as never, ctx.tenantId),
      pending: await listPendingRequests(tx as never, ctx.tenantId),
      makerChecker: await ptMakerCheckerEnabled(tx as never, ctx.tenantId),
    }));
    const byState = new Map<string, typeof versions>();
    for (const v of versions) byState.set(v.stateCode, [...(byState.get(v.stateCode) ?? []), v]);
    const states = [...byState.entries()].map(([stateCode, list]) => ({
      stateCode,
      versions: buildTimeline(list, today),
    }));
    return reply.send({
      today,
      viewerId: ctx.actorId,
      // maker != checker: a new version (and turning this switch off) waits for a DIFFERENT administrator.
      makerChecker,
      pending,
      lastFinalisedMonth,
      // Earliest date a new version may take effect (the day after the latest finalised run's month).
      earliestEffectiveFrom: lastFinalisedMonth ? dayAfter(periodEndOf(lastFinalisedMonth)) : null,
      states,
    });
  });

  app.get("/v1/payroll/statutory/pt/versions/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PT_ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT status, code, kind, state_code, effective_from::text AS effective_from, decided_by::text AS decided_by
        FROM payroll.payroll_pt_version_requests
       WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `))) as unknown as Array<{ status: string; code: string | null; kind: string; state_code: string | null; effective_from: string | null; decided_by: string | null }>;
    const r = rows[0];
    // No row yet = the consumer has not processed the command (still "pending").
    // Otherwise: pending_approval | applied | rejected (a rule failed: `code`) | declined | cancelled.
    // `decidedByViewer` tells a decision this user made from one another administrator made first.
    return reply.send(r
      ? { id, status: r.status, code: r.code, kind: r.kind, stateCode: r.state_code, effectiveFrom: r.effective_from, decidedByViewer: r.decided_by === ctx.actorId }
      : { id, status: "pending", code: null });
  });

  const decide = (decision: "approved" | "rejected") => async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PT_ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ note: z.string().trim().min(1).max(500).optional() }).parse(req.body ?? {});
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT status, maker_id::text AS maker_id FROM payroll.payroll_pt_version_requests
       WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `))) as unknown as Array<{ status: string; maker_id: string }>;
    const r = rows[0];
    if (!r) throw new HttpError(404, "NOT_FOUND", "request not found");
    if (r.status !== "pending_approval") throw new HttpError(409, "INVALID_STATE", `request is already ${r.status}`);
    // maker != checker: the consumer re-asserts this inside its conditional UPDATE.
    if (r.maker_id === ctx.actorId) throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "a PT change must be approved by someone other than its maker");
    return sendAccepted(reply, acceptedResponseSchema, await commands.decidePtRequest(ctx, id, decision, body.note ?? null));
  };
  app.patch("/v1/payroll/statutory/pt/versions/requests/:id/approve", decide("approved"));
  app.patch("/v1/payroll/statutory/pt/versions/requests/:id/reject", decide("rejected"));

  // The tenant switch. ON is immediate; OFF becomes a pending request another administrator must approve.
  app.put("/v1/payroll/statutory/pt/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PT_ADMIN_ROLES);
    const body = z.object({ makerCheckerEnabled: z.boolean(), reason: z.string().trim().min(10).max(500).optional() }).parse(req.body);
    if (!body.makerCheckerEnabled && !body.reason) {
      throw new HttpError(422, "PT_CHECKER_OFF_REASON_REQUIRED", "turning the second approver off needs a reason (at least 10 characters)");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.setPtMakerChecker(ctx, body.makerCheckerEnabled, body.reason ?? null));
  });

  app.post("/v1/payroll/statutory/pt/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PT_ADMIN_ROLES);
    const body = createPtVersionBody.parse(req.body);
    if (!STATES.has(body.stateCode)) {
      throw new HttpError(422, "STATE_CODE_INVALID", "must be an Indian state / UT code, e.g. KA");
    }
    const problem = findSlabSetProblem(body.slabs);
    if (problem) throw new HttpError(422, "PT_SLAB_OVERLAP", problem);

    const { existing, latestFinalisedMonth } = await scopedRead(async (tx) => ({
      existing: await listVersions(tx as never, ctx.tenantId, body.stateCode),
      latestFinalisedMonth: await latestFinalisedRunMonth(tx as never, ctx.tenantId),
    }));
    const verdict = checkNewVersion({
      effectiveFrom: body.effectiveFrom, today: todayIst(), latestFinalisedMonth,
      existingEffectiveFroms: existing.map((v) => v.effectiveFrom), reason: body.reason,
    });
    if (!verdict.ok) {
      throw new HttpError(verdict.failure.code === "PT_BACKDATE_REASON_REQUIRED" ? 422 : 409, verdict.failure.code, verdict.failure.message);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPtVersion(ctx, body));
  });
}
