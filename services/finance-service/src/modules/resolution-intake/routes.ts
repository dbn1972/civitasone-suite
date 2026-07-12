/**
 * Resolution Sanction Intake — routes (role-gated, RLS-scoped).
 *
 * GET   /v1/finance/resolution-intake            — list intake items (default: pending_review)
 * PATCH /v1/finance/resolution-intake/:id/review — accept/reject with optional note (maker-checker)
 *
 * Accept does NOT auto-post a sanction; it marks the item reviewed so a competent
 * officer proceeds via the normal sanction flow (see commands.ts hook comment).
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { intakeListQuery, intakeIdParam, reviewBody } from "./validators.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES  = [...FINANCE_ROLES, "audit_officer"];
// Accepting an action arising from a board resolution is the "checker" step.
const ACCEPT_ROLES  = ["finance_admin", "super_admin"];

export async function resolutionIntakeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/resolution-intake", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const q = intakeListQuery.parse(req.query);
    const result = await queries.listIntake(ctx.tenantId, {
      status: q.status ?? "pending_review",
      page: q.page,
      pageSize: q.pageSize,
    });

    return reply.send({
      data: result.data,
      meta: { page: q.page, pageSize: q.pageSize, total: result.total },
    });
  });

  app.patch("/v1/finance/resolution-intake/:id/review", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = intakeIdParam.parse(req.params);
    const { decision, note } = reviewBody.parse(req.body);

    // Maker-checker: only approver roles may ACCEPT; reject is allowed to all finance roles.
    requireRole(ctx, decision === "accepted" ? ACCEPT_ROLES : FINANCE_ROLES);

    const existing = await queries.getIntakeById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    if (existing.status !== "pending_review") {
      throw new HttpError(409, "ALREADY_REVIEWED", `intake already ${existing.status}`);
    }

    const result = await commands.reviewIntake(ctx, id, decision, note);
    if (!result) throw new HttpError(409, "ALREADY_REVIEWED", "intake already reviewed");

    return reply.send({ data: { id: result.id, status: result.status, reviewedBy: ctx.actorId } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ZodError")) {
      const zodErr = err as unknown as ZodError;
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: zodErr.issues?.map((i) => ({ field: i.path.join("."), message: i.message })) ?? [],
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
