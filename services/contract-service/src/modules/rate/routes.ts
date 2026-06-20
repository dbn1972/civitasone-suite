import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createRcBody, rcQueryParams, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CONTRACT_ROLES = ["procurement_admin", "finance_admin", "super_admin"];
const READER_ROLES   = [...CONTRACT_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function rateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/contract/rate-contracts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const body = createRcBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRateContract(ctx, body));
  });

  app.get("/v1/contract/rate-contracts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { item, tenantId } = rcQueryParams.parse(req.query);
    const tid = tenantId ?? ctx.tenantId;
    if (!item) throw new HttpError(400, "VALIDATION_FAILED", "item query param is required");
    const rcs = await queries.listRateContractsByItem(tid, item);
    return reply.send(rcs);
  });

  app.get("/v1/contract/rate-contracts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rc = await queries.getRateContract(id, ctx.tenantId);
    if (!rc) throw new HttpError(404, "NOT_FOUND", "rate contract not found");
    return reply.send(rc);
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
