import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { seekOpinionBody, draftOpinionBody, issueOpinionBody, idParam, listOpinionsQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { getOrgClient, OrgServiceError } from "../../shared/org-client.js";

const LEGAL_ROLES  = ["legal_officer", "legal_admin", "super_admin"];
const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];

export async function opinionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/opinions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const body = seekOpinionBody.parse(req.body);
    // Owner decision #13: an internal-department addressee must be a real department. An external party needs no lookup.
    if (body.addressee.type === "department") {
      const departmentId = body.addressee.departmentId;
      const departments = await getOrgClient().listDepartments({ tenantId: ctx.tenantId, correlationId: ctx.correlationId });
      if (!departments.some((d) => d.id === departmentId)) {
        throw new HttpError(422, "UNKNOWN_DEPARTMENT", "addressee.departmentId does not reference a department in the organisation hierarchy");
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.seekOpinion(ctx, body));
  });

  app.patch("/v1/legal/opinions/:id/draft", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = draftOpinionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.draftOpinion(ctx, id, body));
  });

  app.patch("/v1/legal/opinions/:id/issue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = issueOpinionBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.issueOpinion(ctx, id, body));
  });

  // Submit an opinion to eOffice for administrative approval. The eFile is raised
  // via the eOffice integration; the decision returns on legal.opinion.file_decided
  // and moves the opinion to issued/rejected.
  app.post("/v1/legal/opinions/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    // GAP-LEGAL-OPINIONS-DETAIL-03: an unknown (or other-tenant) opinion must
    // surface as 404 to the caller, not a 202 that the consumer then silently drops.
    const existing = await queries.getOpinion(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "opinion not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitOpinionForApproval(ctx, id));
  });

  app.get("/v1/legal/opinions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const opinion = await queries.getOpinion(id, ctx.tenantId);
    if (!opinion) throw new HttpError(404, "NOT_FOUND", "opinion not found");
    const [dto] = await queries.withAddressee([opinion], ctx.tenantId, ctx.correlationId);
    return reply.send(dto);
  });

  app.get("/v1/legal/opinions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listOpinionsQuery.parse(req.query);
    const rows = await queries.listOpinions(ctx.tenantId, q.status, q.caseId);
    return reply.send({ items: await queries.withAddressee(rows ?? [], ctx.tenantId, ctx.correlationId) });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  if (err instanceof OrgServiceError) {
    void reply.code(503).send({ code: "ORG_SERVICE_UNAVAILABLE", message: "the department list is temporarily unavailable; please retry", correlationId, retryable: true });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
