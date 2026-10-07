import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { physicalProgressBody, financialProgressBody, dprBody, dprTransitionBody, idParam, dprIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROJ_ROLES   = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];
// GAP-PROJECTS-DPR-TRACKING-01: DPR review/approve/return is an APPROVAL
// control, not a submission — a plain project_officer (who typically submits
// the DPR) must not approve their own. Restricted to the reviewing authority
// roles. The server is the authority (this route 403s everyone else); the web
// hides the action controls from a non-reviewer as defence-in-depth.
const DPR_REVIEW_ROLES = ["project_manager", "super_admin"];

export async function progressRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/projects/:id/physical-progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = physicalProgressBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordPhysicalProgress(ctx, id, body));
  });

  app.post("/v1/projects/:id/financial-progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = financialProgressBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordFinancialProgress(ctx, id, body));
  });

  app.post("/v1/projects/:id/dpr", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = dprBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitDpr(ctx, id, body));
  });

  // GAP-PROJECTS-DPR-TRACKING-01: review workflow transition
  // (review → under_review, approve → approved, return → revision). Enforced
  // server-side (DPR_REVIEW_ROLES) and audited in the consumer's transaction.
  app.patch("/v1/projects/:id/dpr/:dprId/transition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DPR_REVIEW_ROLES);
    const { id, dprId } = dprIdParam.parse(req.params);
    const body = dprTransitionBody.parse(req.body ?? {});
    // A return-for-revision must carry the revision instruction (the submitter
    // reads it); specific 400 rather than a generic schema error.
    if (body.action === "return" && !body.reason) {
      throw new HttpError(400, "REASON_REQUIRED", "a reason is required to return a DPR for revision");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.transitionDpr(ctx, id, dprId, body));
  });

  app.get("/v1/projects/:id/progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await queries.getProgress(id, ctx.tenantId));
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
