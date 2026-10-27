import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { GranteeSummaryListSchema, GranteeDetailSchema } from "@civitasone/schemas/web";
import { listQuerySchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createBeneficiaryBody, linkBankBody, seedAadhaarBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

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

  /** List all beneficiaries for the tenant. */
  app.get("/v1/grants/beneficiaries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listBeneficiariesByTenant(ctx.tenantId, q.limit);
    return reply.send({ data: rows ?? [], meta: { pageSize: q.limit, total: (rows ?? []).length } });
  });

  /**
   * GAP-GRANTS-LIST-03 (DPDP): the only way to see a natural-person grantee's clear name. Same
   * request/response contract as crm-service and hrms-service `POST .../pii/reveal`, so the web
   * MaskedReveal control drives it with only a path change. Grant maker roles only, a reason of
   * at least 10 characters, tenant-scoped (RLS read), and the audit command is queued BEFORE the
   * value is returned (fail closed). The audit payload never contains the value.
   */
  app.post("/v1/grants/pii/reveal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const body = z.object({
      resourceType: z.literal("grantee"),
      resourceId: z.string().uuid(),
      field: z.string().min(1).max(64),
      reason: z.string().trim().min(10, "state why you need the clear value (at least 10 characters)").max(2000),
    }).parse(req.body ?? {});
    if (body.field !== "name") throw new HttpError(422, "FIELD_NOT_REVEALABLE", `field '${body.field}' is not revealable for grantee`);
    const ben = await queries.getBeneficiary(ctx.tenantId, body.resourceId);
    if (!ben || ben.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "grantee not found");
    await commands.recordPiiReveal(ctx, body.resourceId, body.field, body.reason);
    void reply.header("cache-control", "no-store");
    return reply.send({ data: { resourceType: "grantee", resourceId: body.resourceId, field: body.field, value: ben.name } });
  });

  app.get("/v1/grants/grantees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, GranteeSummaryListSchema, await queries.listGranteeSummaries(ctx.tenantId, q.limit));
  });

  // GAP-GRANTS-GRANTEES-04: single-grantee read backing the grantee detail
  // route. Reader-gated and tenant-scoped like the list.
  app.get("/v1/grants/grantees/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getGranteeDetail(ctx.tenantId, id);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "grantee not found");
    sendValidated(reply, GranteeDetailSchema, detail);
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
