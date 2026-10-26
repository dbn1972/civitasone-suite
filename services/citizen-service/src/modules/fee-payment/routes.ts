import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, createScheduleBody, updateScheduleBody, computeFeeBody, createIntentBody,
  recordOfflineBody, confirmPaymentBody, refundRequestBody, refundDecisionBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];
const ADMIN_ROLES   = ["citizen_admin", "super_admin"];

export async function feePaymentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/fees/schedules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createScheduleBody.parse(req.body);
    return reply.code(202).send(await commands.createSchedule(ctx, body));
  });

  /** CLOS3-S1-11: edit = supersede. Unchanged body -> 200 {status:"unchanged"}; changed -> 202 + successor id. */
  app.patch("/v1/citizen/fees/schedules/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateScheduleBody.parse(req.body);
    const result = await commands.updateSchedule(ctx, id, body);
    return reply.code(result.status === "unchanged" ? 200 : 202).send(result);
  });

  app.get("/v1/citizen/fees/schedules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await queries.listSchedules(ctx.tenantId) });
  });

  app.post("/v1/citizen/fees/compute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = computeFeeBody.parse(req.body);
    return reply.send(await queries.computeApplicationFee(ctx, body));
  });

  app.post("/v1/citizen/payments/intent", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = createIntentBody.parse(req.body);
    return reply.code(202).send(await commands.createPaymentIntent(ctx, body));
  });

  app.post("/v1/citizen/payments/offline", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = recordOfflineBody.parse(req.body);
    return reply.code(202).send(await commands.recordOfflinePayment(ctx, body));
  });

  /** FN-14 — confirm pending online intent (staff-relayed gateway callback, or sandbox when CITIZEN_PAYMENTS_SANDBOX_ENABLED=true outside production). */
  app.post("/v1/citizen/payments/:id/confirm", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = confirmPaymentBody.parse(req.body ?? {});
    // A gateway confirmation asserts that money was captured, and gatewayRef is
    // caller-supplied/unverified here. Only staff (gateway callback relay or
    // reconciliation) may assert it; a citizen may only use the sandbox path,
    // which is itself gated by CITIZEN_PAYMENTS_SANDBOX_ENABLED.
    if (body.mode === "gateway") requireRole(ctx, OFFICER_ROLES);
    return reply.code(202).send(await commands.confirmPayment(ctx, id, body));
  });

  app.get("/v1/citizen/payments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const pay = await queries.getPayment(ctx.tenantId, id);
    if (!pay) throw new HttpError(404, "NOT_FOUND", "payment not found");
    const refunds = await queries.listRefunds(ctx.tenantId, id);
    return reply.send({ ...pay, refunds });
  });

  app.post("/v1/citizen/payments/:id/refunds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = refundRequestBody.parse(req.body);
    return reply.code(202).send(await commands.requestRefund(ctx, id, body));
  });

  app.post("/v1/citizen/refunds/:id/decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = refundDecisionBody.parse(req.body);
    return reply.code(202).send(await commands.decideRefund(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
