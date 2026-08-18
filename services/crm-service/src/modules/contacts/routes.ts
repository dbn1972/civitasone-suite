import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createContactBody, updateContactBody, mergeContactsBody, bulkImportBody,
  listContactsQuery, createAccountBody, idParam, contactsListSchema, accountsListSchema,
  classificationBody,
  internalBulkImportBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as leadFieldRules from "../leads/field-rules-repo.js";
import { validateRequiredFields } from "../leads/field-rules-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin"];

function isAdmin(roles: string[]): boolean {
  return roles.some((r) => ADMIN_ROLES.includes(r));
}

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/contacts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createContactBody.parse(req.body);
    // LM-001: the zod schema only knows the platform-wide minimum (name). Which
    // fields a *tenant* insists on is configuration, so it is checked here rather
    // than baked into the validator. 422 not 400: the payload is well formed, it
    // just breaks a tenant business rule. Deliberately only on manual capture —
    // bulk import and PATCH must stay able to land partial records.
    const rules = await leadFieldRules.listRules(ctx.tenantId);
    const missing = validateRequiredFields(body as Record<string, unknown>, rules);
    if (missing.length > 0) {
      throw new HttpError(
        422,
        "MANDATORY_FIELDS_MISSING",
        `missing mandatory field(s): ${missing.join(", ")}`,
      );
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createContact(ctx, body));
  });

  app.get("/v1/crm/contacts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listContactsQuery.parse(req.query);
    sendValidated(reply, contactsListSchema, await queries.listContacts(ctx.tenantId, q.limit, q.offset, {
      ...(q.search ? { search: q.search } : {}),
      ...(q.leadStatus ? { leadStatus: q.leadStatus } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.temperature ? { temperature: q.temperature } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.segmentName ? { segmentName: q.segmentName } : {}),
      ...(q.product ? { product: q.product } : {}),
      ...(q.region ? { region: q.region } : {}),
      ...(q.source ? { leadSource: q.source } : {}),
      ...(q.status ? { contactStatus: q.status } : {}),
      ...(q.expectedValueMin !== undefined ? { expectedValueMin: String(q.expectedValueMin) } : {}),
      ...(q.expectedValueMax !== undefined ? { expectedValueMax: String(q.expectedValueMax) } : {}),
      segment: q.segment,
      actorId: ctx.actorId,
    }, isAdmin(ctx.roles)));
  });

  app.get("/v1/crm/contacts/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const admin = isAdmin(ctx.roles);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(500),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await queries.exportContacts(ctx.tenantId, admin, q.limit, q.offset);
    // Dedicated audit for a bulk PII export (DPDP accountability).
    await commands.auditBulkExport(ctx, rows.length, admin);
    return reply.send({ data: rows, exportedAt: new Date().toISOString(), meta: { limit: q.limit, offset: q.offset, returned: rows.length } });
  });

  app.post("/v1/crm/contacts/bulk/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = bulkImportBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.bulkImportContacts(ctx, body));
  });

  // External-Lead SFTP ingestion (BRD §9 #12 / LM-005): service-to-service bulk
  // lead-create seam. Gated by x-service-secret (INTERNAL_SERVICE_SECRET) via the
  // internal-call path, NOT a user JWT — a normal user token is rejected here so
  // this can never be used to bypass the ADMIN_ROLES gate on /bulk/import. Reuses
  // commands.bulkImportContacts so DQ-001 dedup + all import logic still applies.
  // MK-002: leadSource = source is stamped onto every contact for attribution.
  app.post("/v1/crm/contacts/bulk/import/internal", async (req, reply) => {
    if (req.headers["x-internal"] !== "1") {
      throw new HttpError(401, "UNAUTHENTICATED", "internal route requires service authentication");
    }
    const ctx = resolveContext(req); // validates x-service-secret vs INTERNAL_SERVICE_SECRET
    const body = internalBulkImportBody.parse(req.body);
    if (body.tenantId !== ctx.tenantId) {
      throw new HttpError(400, "TENANT_MISMATCH", "body tenantId must match x-tenant-id");
    }
    const contacts = body.contacts.map((c) => ({ ...c, leadSource: body.source }));
    return sendAccepted(reply, acceptedResponseSchema, await commands.bulkImportContacts(ctx, { contacts }));
  });

  app.post("/v1/crm/contacts/merge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = mergeContactsBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.mergeContacts(ctx, body));
  });

  app.get("/v1/crm/contacts/:id/detail", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getContactDetail(id, ctx.tenantId, isAdmin(ctx.roles));
    if (!detail) throw new HttpError(404, "NOT_FOUND", "contact not found");
    return reply.send(detail);
  });

  app.get("/v1/crm/contacts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const contact = await queries.getContact(id, ctx.tenantId, isAdmin(ctx.roles));
    if (!contact || contact.status === "inactive") throw new HttpError(404, "NOT_FOUND", "contact not found");
    return reply.send(contact);
  });

  app.patch("/v1/crm/contacts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateContactBody.parse(req.body);
    // P1-3 ownership authz: a non-admin may only modify contacts they own.
    if (!isAdmin(ctx.roles)) {
      const existing = await queries.getContact(id, ctx.tenantId, true);
      if (!existing || existing.status === "inactive") {
        throw new HttpError(404, "NOT_FOUND", "contact not found");
      }
      if (existing.ownerId && existing.ownerId !== ctx.actorId) {
        throw new HttpError(403, "FORBIDDEN", "only the owner or an admin may modify this contact");
      }
      // P1-5: a non-admin may not reassign ownership or change lifecycle status.
      delete body.ownerId;
      delete body.status;
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateContact(ctx, id, body));
  });

  app.delete("/v1/crm/contacts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteContact(ctx, id));
  });

  // LQ-003: classify a lead (temperature/priority/segment/product/region/expected value).
  // Async CQRS like every other contact mutation.
  app.patch("/v1/crm/contacts/:id/classification", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = classificationBody.parse(req.body);
    // Ownership authz mirrors PATCH /:id: a non-admin may only classify contacts they own.
    if (!isAdmin(ctx.roles)) {
      const existing = await queries.getContact(id, ctx.tenantId, true);
      if (!existing || existing.status === "inactive") {
        throw new HttpError(404, "NOT_FOUND", "contact not found");
      }
      if (existing.ownerId && existing.ownerId !== ctx.actorId) {
        throw new HttpError(403, "FORBIDDEN", "only the owner or an admin may classify this contact");
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.classifyContact(ctx, id, body));
  });

  app.get("/v1/crm/accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listContactsQuery.parse(req.query);
    sendValidated(reply, accountsListSchema, { data: await queries.listAccounts(ctx.tenantId, q.limit, q.offset) });
  });

  app.post("/v1/crm/accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createAccountBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAccount(ctx, body));
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
