import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createContactBody, updateContactBody, mergeContactsBody, bulkImportBody,
  listContactsQuery, createAccountBody, idParam, contactsListSchema,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin"];

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/contacts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createContactBody.parse(req.body);
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
      segment: q.segment,
      actorId: ctx.actorId,
    }));
  });

  app.get("/v1/crm/contacts/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const rows = await queries.exportContacts(ctx.tenantId);
    return reply.send({ data: rows, exportedAt: new Date().toISOString() });
  });

  app.post("/v1/crm/contacts/bulk/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = bulkImportBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.bulkImportContacts(ctx, body));
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
    const detail = await queries.getContactDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "contact not found");
    return reply.send(detail);
  });

  app.get("/v1/crm/contacts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const contact = await queries.getContact(id, ctx.tenantId);
    if (!contact || contact.status === "deleted") throw new HttpError(404, "NOT_FOUND", "contact not found");
    return reply.send(contact);
  });

  app.patch("/v1/crm/contacts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateContactBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateContact(ctx, id, body));
  });

  app.delete("/v1/crm/contacts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteContact(ctx, id));
  });

  app.get("/v1/crm/accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    return reply.send({ data: await queries.listAccounts(ctx.tenantId) });
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
