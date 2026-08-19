import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createChallanBody, createDepositBody, depositDispositionBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function treasuryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/challans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createChallanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createChallan(ctx, body));
  });

  app.get("/v1/finance/banks/:id/balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const bank = await queries.getBankBalance(id, ctx.tenantId);
    if (!bank || bank.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "bank account not found");
    return reply.send({
      id: bank.id,
      name: bank.name,
      accountNoLast4: String(bank.accountNo).slice(-4),
      balanceMinor: bank.balanceMinor.toString(),
      currency: bank.currency,
    });
  });

  app.post("/v1/finance/deposits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createDepositBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDeposit(ctx, body));
  });

  // P1-3: deposit lifecycle — refund / forfeit / adjust-against-bill.
  app.post("/v1/finance/deposits/:id/refund", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = depositDispositionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.refundDeposit(ctx, id, body));
  });

  app.post("/v1/finance/deposits/:id/forfeit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = depositDispositionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.forfeitDeposit(ctx, id, body));
  });

  app.post("/v1/finance/deposits/:id/adjust", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = depositDispositionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.adjustDeposit(ctx, id, body));
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
