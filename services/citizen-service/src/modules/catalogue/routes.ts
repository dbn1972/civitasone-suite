import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { z } from "zod";
import { idParam, createDefinitionBody, updateDefinitionBody, serviceKeyQuery, localizationQuery } from "./validators.js";
import * as derived from "./derived.js";

const rejectBody = z.object({ comment: z.string().min(1).max(2000) });
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];
const ADMIN_ROLES   = ["citizen_admin", "super_admin"];

export async function catalogueRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/catalogue/services", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createDefinitionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDefinition(ctx, body));
  });

  app.patch("/v1/citizen/catalogue/services/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDefinitionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDefinition(ctx, id, body));
  });

  app.post("/v1/citizen/catalogue/services/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitDefinition(ctx, id));
  });

  app.post("/v1/citizen/catalogue/services/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.publishDefinition(ctx, id));
  });

  app.post("/v1/citizen/catalogue/services/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const { comment } = rejectBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectDefinition(ctx, id, comment));
  });

  app.get("/v1/citizen/catalogue/services", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await queries.listDefinitions(ctx.tenantId) });
  });

  app.get("/v1/citizen/catalogue/published", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    return reply.send({ data: await queries.browsePublished(ctx.tenantId) });
  });

  app.get("/v1/citizen/catalogue/published/lookup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { serviceKey } = serviceKeyQuery.parse(req.query);
    const def = await queries.getPublishedByKey(ctx.tenantId, serviceKey);
    if (!def) throw new HttpError(404, "NOT_FOUND", "no published definition for service key");
    return reply.send(def);
  });

  app.get("/v1/citizen/catalogue/services/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const def = await queries.getDefinition(ctx.tenantId, id);
    if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
    return reply.send(def);
  });

  /* ── Phase 3 derived views ────────────────────────────────────────────────
   * FN-32, FN-16, FN-31, FN-28 and FN-18 store nothing: each is computed from
   * blocks the definition already carries. Serving them as derived endpoints
   * rather than persisted columns means a stored copy can never drift from the
   * form or fee it describes.
   */

  /** FN-32 — accessibility & GIGW preview for the definition's form. */
  app.get("/v1/citizen/catalogue/services/:id/a11y-preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const def = await queries.getDefinition(ctx.tenantId, id);
    if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
    return reply.send({ data: derived.a11yPreviewFor(def) });
  });

  /** FN-16 + FN-31 — auto-attached reports and KPI tiles for this pattern. */
  app.get("/v1/citizen/catalogue/services/:id/analytics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const def = await queries.getDefinition(ctx.tenantId, id);
    if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
    return reply.send({ data: derived.analyticsFor(def) });
  });

  /** FN-28 — the RTI catalogue entry, or null when not published to RTI. */
  app.get("/v1/citizen/catalogue/services/:id/rti-entry", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const def = await queries.getDefinition(ctx.tenantId, id);
    if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
    return reply.send({ data: derived.rtiEntryFor(def) });
  });

  /** FN-18 — translatable string inventory and per-locale coverage. */
  app.get("/v1/citizen/catalogue/services/:id/localization", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const { locale } = localizationQuery.parse(req.query ?? {});
    const def = await queries.getDefinition(ctx.tenantId, id);
    if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
    return reply.send({ data: derived.localizationFor(def, locale) });
  });

  /**
   * FN-28 — the whole tenant's RTI catalogue export.
   * Published services only: an unpublished draft is not a service the public
   * can request information about yet.
   */
  app.get("/v1/citizen/catalogue/rti-export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const defs = await queries.listDefinitions(ctx.tenantId);
    return reply.send({ data: derived.rtiExport(defs) });
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
