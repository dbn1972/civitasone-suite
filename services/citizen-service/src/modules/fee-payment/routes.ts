import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, createScheduleBody, computeFeeBody, createIntentBody,
  recordOfflineBody, refundRequestBody, refundDecisionBody,
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
    return reply.code(201).send(await commands.createSchedule(ctx, body));
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
    return reply.send(await commands.computeApplicationFee(ctx, body));
  });

  app.post("/v1/citizen/payments/intent", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = createIntentBody.parse(req.body);
    return reply.code(201).send(await commands.createPaymentIntent(ctx, body));
  });

  app.post("/v1/citizen/payments/offline", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = recordOfflineBody.parse(req.body);
    return reply.code(201).send(await commands.recordOfflinePayment(ctx, body));
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

  // --- Refund maker-checker ----------------------------------------------------
  app.post("/v1/citizen/payments/:id/refunds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = refundRequestBody.parse(req.body);
    return reply.code(201).send(await commands.requestRefund(ctx, id, body));
  });

  app.post("/v1/citizen/refunds/:id/decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = refundDecisionBody.parse(req.body);
    return reply.send(await commands.decideRefund(ctx, id, body));
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
