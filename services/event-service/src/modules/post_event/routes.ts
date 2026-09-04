import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as permitsRepo from "../permits/repo.js";
import * as applicationsRepo from "../applications/repo.js";
import * as commands from "./commands.js";
import { canDecideDeposit, checkInspectionEligibility, computeRefundMinor } from "./domain.js";

const ADMIN_ROLES = ["event_admin", "super_admin"];

const inspectionBody = z.object({
  permitId: z.string().uuid(),
  findings: z.record(z.unknown()),
  damageAssessment: z.record(z.unknown()).optional(),
});

const depositBody = z.object({
  decision: z.enum(["full_refund", "partial_refund", "forfeited"]),
  // Was a bare optional string: a non-numeric value reached BigInt() inside the
  // async consumer and threw there, AFTER the HTTP caller already got 202 —
  // the caller believed the decision succeeded when nothing was ever written.
  // Validating the shape synchronously here closes that; the actual bounds
  // check against the real deposit happens below via computeRefundMinor.
  //
  // zMoneyMinorStringNonNeg is the canonical @civitasone/schemas money codec
  // (R7): same effective validation as the hand-rolled `z.string().regex(/^\d+$/)`
  // this replaced (non-negative base-10 integer, normalised to a string), but
  // also accepts a JSON safe-integer number instead of 400ing it, and rejects
  // an unsafe (>2^53) number outright instead of silently letting it through.
  // Consistency-only swap, not a correctness fix: this field's value already
  // flowed as a string straight into `BigInt(body.refundMinor)` below with no
  // intermediate `Number()`/`parseInt()` anywhere on the path (see also
  // post_event/consumer.ts's `BigInt(p.refundMinor)`), so there was no
  // precision-loss bug here to begin with -- verified by reading the actual
  // consumer, not assumed from roadcut-service's identical (and, on the same
  // reading, equally safe) pattern.
  refundMinor: zMoneyMinorStringNonNeg.optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function postEventRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/event/post-inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = inspectionBody.parse(req.body);
    // CRITICAL fix: previously conducted unconditionally — no check that the
    // permit exists, hasn't been revoked, or that the event has actually
    // concluded (validUntil in the past).
    const permit = await permitsRepo.findById(body.permitId, ctx.tenantId);
    const eligibility = checkInspectionEligibility(permit);
    if (!eligibility.eligible) {
      throw new HttpError(422, "NOT_ELIGIBLE_FOR_INSPECTION", eligibility.reason);
    }
    return reply.code(202).send(
      await commands.conductInspection(ctx, body.permitId, body.findings, body.damageAssessment),
    );
  });

  app.get("/v1/event/post-inspections/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Post-event inspection not found");
    return reply.send({ data: row });
  });

  app.post("/v1/event/post-inspections/:id/deposit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = depositBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Post-event inspection not found");
    if (!canDecideDeposit(existing)) {
      throw new HttpError(422, "ALREADY_DECIDED", "Deposit already decided");
    }
    // CRITICAL fix, the money bug: derive the actual, bounded refund amount
    // server-side from the deposit really collected (permit -> application,
    // a two-hop lookup that previously didn't exist anywhere in this module),
    // rather than trusting the client's refundMinor verbatim. See
    // domain.ts's computeRefundMinor for the exact rules per decision.
    const permit = await permitsRepo.findById(existing.permitId, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Permit not found for this inspection");
    const application = await applicationsRepo.findById(permit.applicationId, ctx.tenantId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found for this permit");
    const depositMinor = application.depositMinor ?? 0n;
    let refundMinor: bigint;
    try {
      refundMinor = computeRefundMinor(
        body.decision,
        depositMinor,
        body.refundMinor !== undefined ? BigInt(body.refundMinor) : undefined,
      );
    } catch (err) {
      throw new HttpError(422, "INVALID_REFUND_AMOUNT", err instanceof Error ? err.message : "Invalid refund amount");
    }
    return reply.code(202).send(await commands.decideDeposit(ctx, id, body.decision, refundMinor.toString()));
  });
}
