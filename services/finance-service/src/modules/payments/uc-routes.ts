/**
 * Utilisation-certificate lifecycle (fp-finance-01): verify / return / resubmit.
 * Routes validate and publish; uc-consumer.ts performs the conditional transition.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { readSettings } from "../approvals/repo.js";
import { DomainError, assertDistinctMakerChecker } from "./domain.js";
import { assertUCDecidable, assertUCResubmittable, assertUCWithinSanction } from "./uc-domain.js";
import { findUCForTenant, findApprovedSanctionByNo, sumClaimedForGrantRef } from "./uc-repo.js";
import { scopedRead } from "../../shared/db.js";
import { idParam, rejectUCBody, resubmitUCBody } from "./validators.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const VERIFIER_ROLES = ["finance_admin", "super_admin"];

function toHttp(err: unknown, status = 409): never {
  if (err instanceof DomainError) throw new HttpError(status, err.code, err.message);
  throw err;
}

export async function ucLifecycleRoutes(app: FastifyInstance): Promise<void> {
  async function publish(
    topic: string, ctx: ReturnType<typeof resolveContext>, id: string, extra: Record<string, unknown>,
  ) {
    await queue.publish(topic, {
      // Fresh id per decision: a UC can be returned, resubmitted and returned again.
      messageId: randomUUID(), type: topic,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...extra },
    });
  }

  app.post("/v1/finance/utilization-certificates/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VERIFIER_ROLES);
    const { id } = idParam.parse(req.params);
    const uc = await findUCForTenant(ctx.tenantId, id);
    if (!uc) throw new HttpError(404, "NOT_FOUND", "utilization certificate not found");
    try {
      assertUCDecidable(uc.status);
      if ((await readSettings(ctx.tenantId)).makerCheckerEnabled) assertDistinctMakerChecker(uc.createdBy, ctx.actorId);
    } catch (err) { toHttp(err); }
    await publish(COMMANDS.ucVerify, ctx, id, {});
    return reply.code(202).send({ id, status: "accepted" });
  });

  app.post("/v1/finance/utilization-certificates/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VERIFIER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectUCBody.parse(req.body);
    const uc = await findUCForTenant(ctx.tenantId, id);
    if (!uc) throw new HttpError(404, "NOT_FOUND", "utilization certificate not found");
    try {
      assertUCDecidable(uc.status);
      if ((await readSettings(ctx.tenantId)).makerCheckerEnabled) assertDistinctMakerChecker(uc.createdBy, ctx.actorId);
    } catch (err) { toHttp(err); }
    await publish(COMMANDS.ucReject, ctx, id, { reason: body.reason });
    return reply.code(202).send({ id, status: "accepted" });
  });

  app.post("/v1/finance/utilization-certificates/:id/resubmit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resubmitUCBody.parse(req.body ?? {});
    const uc = await findUCForTenant(ctx.tenantId, id);
    if (!uc) throw new HttpError(404, "NOT_FOUND", "utilization certificate not found");
    try { assertUCResubmittable(uc.status); } catch (err) { toHttp(err); }
    // Over-claim pre-check (the consumer repeats it under the sanction lock): a returned UC does not count, so the headroom may be gone.
    if (uc.grantRef) {
      const grantRef = uc.grantRef;
      const sanction = await scopedRead((tx) => findApprovedSanctionByNo(tx, ctx.tenantId, grantRef));
      if (sanction) {
        const claimed = await scopedRead((tx) => sumClaimedForGrantRef(tx, ctx.tenantId, grantRef, uc.id));
        try { assertUCWithinSanction(sanction.amountMinor, claimed, uc.amountMinor); } catch (err) { toHttp(err); }
      }
    }
    await publish(COMMANDS.ucResubmit, ctx, id, { note: body.note ?? null });
    return reply.code(202).send({ id, status: "accepted" });
  });

  app.setErrorHandler(financeErrorHandler);
}
