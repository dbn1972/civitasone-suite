import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { enrolOperatorBody, updateOperatorBody, listOperatorsQuery, eligibilityQuery, resolveOfficersQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { findOperatorById } from "./repo.js";
import { checkEligibility } from "./eligibility.js";

// Division admins (and estab/super admins) enrol and manage operators.
const ADMIN_ROLES = ["estab_division_admin", "estab_admin", "super_admin"];
const READER_ROLES = [...ADMIN_ROLES, "estab_officer", "audit_officer"];

// UAT W8-A: a malformed :id reached the uuid column and 500ed (22P02); it is a 400 now.
const idParam = z.object({ id: z.string().uuid() });

export async function operatorRoutes(app: FastifyInstance): Promise<void> {
  /** List enrolled operators (the forward-to / marking candidates). */
  app.get("/v1/estab/operators", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listOperatorsQuery.parse(req.query);
    const data = await queries.listOperators(ctx.tenantId, { division: q.division, deskRole: q.deskRole, activeOnly: q.activeOnly }, q.limit);
    return reply.send({ data });
  });

  /**
   * Resolve officer ids (employee ids or actor ids) to display names for the
   * ids a screen renders. Replaces pulling a whole directory into the browser.
   */
  app.get("/v1/estab/officers/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = resolveOfficersQuery.parse(req.query);
    const data = await queries.resolveOfficerLabels(ctx.tenantId, q.ids);
    return reply.send({ data });
  });

  /** Check whether an employee may operate eOffice files (optionally in a division). */
  app.get("/v1/estab/operators/eligibility", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = eligibilityQuery.parse(req.query);
    const result = await checkEligibility(ctx.tenantId, q.employeeId, { division: q.division, requireInitiate: q.initiate });
    return reply.send({ data: result });
  });

  app.get("/v1/estab/operators/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const op = await queries.getOperator(ctx.tenantId, id);
    if (!op) throw new HttpError(404, "NOT_FOUND", "operator not found");
    return reply.send({ data: op });
  });

  /** Division admin enrols an employee as a file operator. */
  app.post("/v1/estab/operators", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = enrolOperatorBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.enrolOperator(ctx, body));
  });

  /** Update / deactivate an operator desk. */
  app.patch("/v1/estab/operators/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateOperatorBody.parse(req.body);
    // UAT W8-A: tenant-scoped existence read; an unknown operator answers 404, not 202.
    if (!(await findOperatorById(id, ctx.tenantId))) throw new HttpError(404, "NOT_FOUND", "operator not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateOperator(ctx, id, body));
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
