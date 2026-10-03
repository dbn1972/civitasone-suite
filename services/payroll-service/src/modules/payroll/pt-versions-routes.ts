/**
 * GAP-PAYROLL-STATUTORY-PT-04: professional-tax slab versions.
 *
 *   GET  /v1/payroll/statutory/pt/versions[?stateCode=]  timeline per state
 *   POST /v1/payroll/statutory/pt/versions               create a new version
 *
 * The POST is a command route: zod + read-only guards here, publish, 202; the
 * write (transaction + audit outbox event, guards re-checked under a lock) is
 * pt-versions-consumer.ts. payroll_admin / super_admin only.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { INDIAN_STATE_UT_CODES } from "./state-rules.js";
import {
  buildTimeline, checkNewVersion, createPtVersionBody, findSlabSetProblem, periodEndOf, dayAfter, todayIst,
} from "./pt-versions-domain.js";
import { latestFinalisedRunMonth, listVersions } from "./pt-versions-repo.js";
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
    const { versions, lastFinalisedMonth } = await scopedRead(async (tx) => ({
      versions: await listVersions(tx as never, ctx.tenantId, q.stateCode),
      lastFinalisedMonth: await latestFinalisedRunMonth(tx as never, ctx.tenantId),
    }));
    const byState = new Map<string, typeof versions>();
    for (const v of versions) byState.set(v.stateCode, [...(byState.get(v.stateCode) ?? []), v]);
    const states = [...byState.entries()].map(([stateCode, list]) => ({
      stateCode,
      versions: buildTimeline(list, today),
    }));
    return reply.send({
      today,
      lastFinalisedMonth,
      // Earliest date a new version may take effect (the day after the latest finalised run's month).
      earliestEffectiveFrom: lastFinalisedMonth ? dayAfter(periodEndOf(lastFinalisedMonth)) : null,
      states,
    });
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
