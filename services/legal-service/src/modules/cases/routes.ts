import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createCaseBody, disposeCaseBody, idParam, listCasesQuery, createCaseTypeBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

const LEGAL_ROLES  = ["legal_officer", "legal_admin", "super_admin"];
const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];
// Case-type master is reference data: only admins may create/seed it.
const CASE_TYPE_ADMIN_ROLES = ["legal_admin", "super_admin"];

export async function caseRoutes(app: FastifyInstance): Promise<void> {
  // ── GAP-LEGAL-CASES-NEW-01: case-type master ───────────────────────────────
  // List the tenant's case types (reader roles) — feeds the create-case select.
  app.get("/v1/legal/case-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send({ items: await queries.listCaseTypes(ctx.tenantId) });
  });

  // Create a single case type (admin only).
  app.post("/v1/legal/case-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CASE_TYPE_ADMIN_ROLES);
    const body = createCaseTypeBody.parse(req.body);
    const existing = await repo.findCaseTypeByCode(ctx.tenantId, body.code);
    if (existing) {
      throw new HttpError(409, "DUPLICATE_CASE_TYPE_CODE", "a case type with this code already exists");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCaseType(ctx, body));
  });

  // Idempotently seed the default case-type baseline (admin only).
  app.post("/v1/legal/case-types/seed-defaults", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CASE_TYPE_ADMIN_ROLES);
    return sendAccepted(reply, acceptedResponseSchema, await commands.seedDefaultCaseTypes(ctx));
  });

  app.post("/v1/legal/cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const body = createCaseBody.parse(req.body);
    // GAP-LEGAL-CASES-NEW-03: reject a duplicate (tenant, caseNo) synchronously
    // with 409 — otherwise the async create consumer would hit the
    // UNIQUE (tenant_id, case_no) constraint only after the API returned 202,
    // a silent background failure with no feedback to the registrar.
    const existing = await repo.findCaseByTenantAndNo(ctx.tenantId, body.caseNo);
    if (existing) {
      throw new HttpError(409, "DUPLICATE_CASE_NO", "a case with this case number already exists");
    }
    // GAP-LEGAL-CASES-NEW-01: a supplied caseTypeId must reference a real
    // tenant-scoped case type — reject a dangling id synchronously rather than
    // persisting a case pointing at a non-existent type.
    if (body.caseTypeId) {
      const caseType = await repo.findCaseTypeById(ctx.tenantId, body.caseTypeId);
      if (!caseType) {
        throw new HttpError(400, "UNKNOWN_CASE_TYPE", "caseTypeId does not reference a known case type");
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCase(ctx, body));
  });

  app.patch("/v1/legal/cases/:id/dispose", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = disposeCaseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.disposeCase(ctx, id, body));
  });

  app.get("/v1/legal/cases/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const legalCase = await queries.getCase(id, ctx.tenantId);
    if (!legalCase) throw new HttpError(404, "NOT_FOUND", "case not found");
    return reply.send(legalCase);
  });

  app.get("/v1/legal/cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listCasesQuery.parse(req.query);
    return reply.send({ items: await queries.listCases(ctx.tenantId, q.status, q.type) });
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
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
