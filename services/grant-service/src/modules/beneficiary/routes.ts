import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createBeneficiaryBody, linkBankBody, seedAadhaarBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const GRANT_ROLES  = ["grant_officer", "grant_admin", "super_admin"];
const READER_ROLES = [...GRANT_ROLES, "audit_officer"];

export async function beneficiaryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/grants/beneficiaries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const body = createBeneficiaryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBeneficiary(ctx, body));
  });

  app.post("/v1/grants/beneficiaries/:id/bank", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = linkBankBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.linkBank(ctx, id, body));
  });

  app.post("/v1/grants/beneficiaries/:id/aadhaar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = seedAadhaarBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.seedAadhaar(ctx, id, body));
  });

  app.get("/v1/grants/beneficiaries/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const ben = await queries.getBeneficiary(ctx.tenantId, id);
    if (!ben) throw new HttpError(404, "NOT_FOUND", "beneficiary not found");
    return reply.send(ben);
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
