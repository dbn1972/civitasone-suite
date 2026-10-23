import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { fetchUserNames } from "../../shared/identity-client.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { getProposal } from "../proposal/repo.js";
import { withMaskedPan } from "./mask.js";
import { ratingCooldownDays, isWithinRatingCooldown } from "./rating-policy.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do"];
// Unmasked PAN is DPDP-sensitive: narrower than WRITE_ROLES (no works_operator).
const PII_REVEAL_ROLES = ["works_admin", "super_admin", "dao", "do"];
const READ_ROLES  = [...WRITE_ROLES, "works_viewer", "sdo", "section_officer", "estimator"];

export async function contractorRoutes(app: FastifyInstance): Promise<void> {
  // List contractors
  app.get("/v1/works/contractors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = v.contractorListQuerySchema.parse(req.query);
    const [rows, total] = await Promise.all([
      repo.listContractors(ctx.tenantId, { limit: q.limit, offset: q.offset }),
      repo.countContractors(ctx.tenantId),
    ]);
    // GAP-WORKS-CONTRACTORS-06 (DPDP): the register never carries a clear PAN, whatever the caller's role. The
    // audited reveal endpoint is the only way to read one from a list context.
    const data = rows.map(withMaskedPan);
    return reply.send({ data, meta: { limit: q.limit, offset: q.offset, page: q.page, pageSize: q.pageSize, total } });
  });

  // Get contractor by id
  app.get("/v1/works/contractors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const row = await repo.findContractorById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    // The clear PAN is returned only to the roles entitled to reveal it (PII_REVEAL_ROLES, the same set that may call
    // reveal-pan); every other reader gets the masked form.
    return reply.send({ data: hasAnyRole(ctx, PII_REVEAL_ROLES) ? row : withMaskedPan(row) });
  });

  // Get contractor rating history
  app.get("/v1/works/contractors/:id/rating-history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const { limit } = v.listQuerySchema.parse(req.query);
    const rows = await repo.listRatingHistory(ctx.tenantId, id, Math.min(limit, 100));
    // GAP-WORKS-CONTRACTORS-DETAIL-03: resolve who rated, server-side, through identity-service (no cross-service
    // SQL). An officer who cannot be resolved gets ratedByName null; the raw ratedBy id stays in the row for the
    // self-cooldown check but is never what the UI prints.
    const names = await fetchUserNames(ctx.tenantId, rows.map((r) => r.ratedBy));
    const data = rows.map((r) => ({ ...r, ratedByName: names.get(r.ratedBy) ?? null }));
    // meta.cooldownDays tells the rating form how long a repeat rating by the same officer is held back (0 = none).
    return reply.send({ data, meta: { cooldownDays: ratingCooldownDays() } });
  });

  // Create contractor
  app.post("/v1/works/contractors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createContractorSchema.parse(req.body);
    if (body.registrationNo && (await repo.findContractorByRegistrationNo(ctx.tenantId, body.registrationNo))) {
      throw new HttpError(409, "DUPLICATE_REGISTRATION_NO", "A contractor with this registration number already exists");
    }
    const result = await commands.createContractor(ctx, body);
    return reply.status(202).send(result);
  });

  // Rate contractor (performance rating 1–5)
  app.patch("/v1/works/contractors/:id/rate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const body = v.rateContractorSchema.parse(req.body);
    const existing = await repo.findContractorById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "contractor not found");

    // GAP-WORKS-CONTRACTORS-DETAIL-04: a rating may name the work it is about; that work must exist in this tenant.
    if (body.workId && !(await getProposal(ctx.tenantId, body.workId))) {
      throw new HttpError(404, "NOT_FOUND", "work not found");
    }

    // GAP-WORKS-CONTRACTORS-DETAIL-04: the same officer may not rate the same contractor again inside the configured
    // cooling-off period. 409 so the rating dialog stays open with a clear message; the consumer re-checks.
    const cooldownDays = ratingCooldownDays();
    if (cooldownDays > 0) {
      const last = await repo.latestRatingByActor(ctx.tenantId, id, ctx.actorId);
      if (last && isWithinRatingCooldown(last.ratedAt, new Date(), cooldownDays)) {
        throw new HttpError(409, "RATING_COOLDOWN", `You have already rated this contractor within the last ${cooldownDays} days`);
      }
    }

    const result = await commands.rateContractor(ctx, id, body.rating, body.comment, body.workId);
    return reply.status(202).send(result);
  });

  // Reveal a contractor's clear PAN (DPDP: role-gated + reason-audited).
  app.post("/v1/works/contractors/:id/reveal-pan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PII_REVEAL_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const body = v.revealPanSchema.parse(req.body);
    const existing = await repo.findContractorById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    const { value } = await commands.revealContractorPan(ctx, id, body.reason);
    reply.header("cache-control", "no-store");
    return reply.send({ data: { value } });
  });

  // Update contractor basic info
  //
  // GAP2-WORKS-CONTRACTORS-03: this edit now routes through the CQRS command
  // path (publish works.contractor.update → consumer applies + emits
  // audit.event.record in one tx) instead of writing to Postgres directly in
  // the handler and returning 200 with no audit event. Existence is checked
  // here for a fast 404; the consumer re-asserts it authoritatively.
  app.patch("/v1/works/contractors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = v.idParamSchema.parse(req.params);
    const body = v.updateContractorSchema.parse(req.body);
    const existing = await repo.findContractorById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    if (body.registrationNo && (await repo.findContractorByRegistrationNo(ctx.tenantId, body.registrationNo, id))) {
      throw new HttpError(409, "DUPLICATE_REGISTRATION_NO", "A contractor with this registration number already exists");
    }
    const patch = Object.fromEntries(
      Object.entries(body).filter(([, val]) => val !== undefined),
    ) as Record<string, unknown>;
    const result = await commands.updateContractor(ctx, id, patch);
    return reply.status(202).send(result);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError)
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        // Same per-field shape as the app-wide envelope (packages/schemas createFastifyErrorHandler), so the web's
        // useFormError can show each message against its own field.
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    if (err instanceof HttpError)
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
