/**
 * contacts module HTTP routes (Fastify plugin).
 * Middleware order: correlationId → auth → authz → zod validate → handler.
 * Writes return 202 (command accepted, applied async). Reads return 200 from cache.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createContactBody, idParam, contactsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/contacts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createContactBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createContact(ctx, body));
  });

  app.get("/v1/crm/contacts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, contactsListSchema, await queries.listContacts(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/crm/contacts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const contact = await queries.getContact(id, ctx.tenantId);
    if (!contact) throw new HttpError(404, "NOT_FOUND", "contact not found");
    return reply.send(contact);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
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
