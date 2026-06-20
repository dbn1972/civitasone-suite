import { sendAccepted } from "@civitasone/schemas/validate";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createContractBody, amendContractBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CONTRACT_ROLES = ["procurement_admin", "finance_admin", "super_admin"];
const READER_ROLES   = [...CONTRACT_ROLES, "audit_officer", "procurement_officer"];

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/contract/contracts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const body = createContractBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createContract(ctx, body));
  });

  app.patch("/v1/contract/contracts/:id/amend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONTRACT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = amendContractBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.amendContract(ctx, id, body));
  });

  app.get("/v1/contract/contracts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const contracts = await queries.listContracts(ctx.tenantId, q.limit);
    return reply.send({ data: contracts, pagination: { hasMore: contracts.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/contract/contracts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const contract = await queries.getContract(id, ctx.tenantId);
    if (!contract) throw new HttpError(404, "NOT_FOUND", "contract not found");
    return reply.send(contract);
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
