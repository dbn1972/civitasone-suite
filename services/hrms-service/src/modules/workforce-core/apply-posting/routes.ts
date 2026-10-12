/**
 * applyPosting — HTTP route (SmartTransfer OS, ST-M01-09).
 *
 * POST /v1/hrms/workforce-core/postings/apply
 *   route → zod → command (deterministic messageId from orderId) → 202.
 *
 * Staff-only (requireRole excludes citizen — house rule 9). The write itself
 * happens asynchronously in the single applyPosting consumer. The route is only
 * mounted when WORKFORCE_CORE_LEDGER_ENABLED is on (app.ts gates registration);
 * if somehow reached while off it returns 503 FEATURE_DISABLED so the legacy
 * behaviour (no posting ledger) is never bypassed.
 *
 * This is the in-service HTTP affordance for the SAME applyPosting path that
 * SmartTransfer drives via the `hrms.posting.apply` command (D-ST-10). Both
 * land on the one consumer; neither writes HRMS tables outside it.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import {
  resolveContext,
  requireRole,
  HttpError,
} from "../../../shared/context.js";
import { isPostingLedgerEnabled } from "../config.js";
import { applyPostingBody } from "./validators.js";
import * as commands from "./commands.js";

// Posting is a competent-authority action: HR admin (and super_admin), not the
// broader hr_officer. Matches the lifecycle PPO precedent (HR_ADMIN_ROLES).
const POSTING_ROLES = ["hr_admin", "super_admin"];

export async function applyPostingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/workforce-core/postings/apply", async (req, reply) => {
    if (!isPostingLedgerEnabled()) {
      throw new HttpError(
        503,
        "FEATURE_DISABLED",
        "the Workforce Core posting ledger is not enabled for this deployment",
      );
    }
    const ctx = resolveContext(req);
    requireRole(ctx, POSTING_ROLES);
    const body = applyPostingBody.parse(req.body);
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.applyPosting(ctx, body),
    );
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError)
      return reply
        .code(400)
        .send({
          code: "VALIDATION_FAILED",
          message: "invalid request",
          correlationId,
        });
    if (err instanceof HttpError)
      return reply
        .code(err.status)
        .send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply
      .code(500)
      .send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
