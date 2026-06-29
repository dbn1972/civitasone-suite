import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createHandoverBody, listHandoverQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { isActiveOperator, tenantHasOperators } from "../operators/eligibility.js";

const ADMIN_ROLES = ["estab_division_admin", "estab_admin", "super_admin"];
const READER_ROLES = [...ADMIN_ROLES, "estab_officer", "audit_officer"];

export async function handoverRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/handovers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listHandoverQuery.parse(req.query);
    const data = await queries.listHandovers(ctx.tenantId, { status: q.status }, q.limit);
    return reply.send({ data });
  });

  /**
   * Hand over an officer's entire file charge to another officer.
   * The receiving officer MUST be an active eOffice operator — files can only
   * be held by enrolled operators.
   */
  app.post("/v1/estab/handovers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createHandoverBody.parse(req.body);

    if (await tenantHasOperators(ctx.tenantId) && !(await isActiveOperator(ctx.tenantId, body.toOfficerId))) {
      throw new HttpError(422, "NOT_AN_OPERATOR", "receiving officer is not an active eOffice operator; enrol them first");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createHandover(ctx, body));
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
