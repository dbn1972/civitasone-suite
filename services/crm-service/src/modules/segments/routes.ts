/**
 * Customer-segment taxonomy routes (G5).
 *
 * GET    /v1/crm/segments                            — list (standard pagination envelope)
 * POST   /v1/crm/segments                            — create a draft segment
 * GET    /v1/crm/segments/settings                   — read the tenant's enforcement switch
 * PUT    /v1/crm/segments/settings                   — set the enforcement switch
 * GET    /v1/crm/segments/:segmentCode               — read one definition
 * PATCH  /v1/crm/segments/:segmentCode               — amend (optimistic locking)
 * DELETE /v1/crm/segments/:segmentCode               — soft-delete
 * POST   /v1/crm/segments/:segmentCode/publish       — make it enforceable / eligible
 * POST   /v1/crm/segments/:segmentCode/deprecate     — retire it
 * GET    /v1/crm/segments/:segmentCode/eligibility   — the priority-product / channel contract
 *
 * Mutations are CQRS: validate with zod → `queue.publish` → 202. The writes live in
 * consumer.ts. Synchronous refusals (404 / 409 / 422) are answered here, before the
 * command is published, so a caller gets a real answer instead of a 202 that quietly
 * does nothing.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createSegmentBody,
  updateSegmentBody,
  segmentCodeParam,
  listSegmentsQuery,
  segmentSettingsBody,
  segmentsListSchema,
  eligibilityResponseSchema,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { canDeprecate, canPublish, isMutable, SEGMENT_ERROR_CODES } from "./domain.js";
import type { SegmentDefinitionView } from "./schema.js";

/** Anyone who works in CRM may read the taxonomy — it drives the UI's segment picker. */
const READ_ROLES = ["crm_user", "crm_admin", "tenant_admin", "super_admin"];
/** The taxonomy is governance: only admins may change it. */
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

export async function segmentRoutes(app: FastifyInstance): Promise<void> {
  /** Load a live definition or 404. Shared by every per-segment route. */
  async function loadOr404(tenantId: string, segmentCode: string): Promise<SegmentDefinitionView> {
    const segment = await queries.getSegment(tenantId, segmentCode);
    if (!segment) throw new HttpError(404, SEGMENT_ERROR_CODES.notFound, "segment definition not found");
    return segment;
  }

  /**
   * Canonical rows are reference data delivered as seed. Any mutation is refused with
   * 422 regardless of the caller's role — role is deliberately not consulted, so the
   * platform catalogue cannot diverge per tenant through an admin's mistake.
   */
  function assertMutable(segment: SegmentDefinitionView): void {
    if (!isMutable(segment.governance)) {
      throw new HttpError(
        422,
        SEGMENT_ERROR_CODES.canonicalImmutable,
        "canonical segment definitions are immutable; create a tenant segment instead",
      );
    }
  }

  app.post("/v1/crm/segments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createSegmentBody.parse(req.body);
    // Includes soft-deleted rows: a segmentCode is a stable machine key, so a retired
    // one stays reserved rather than being reused for a different meaning.
    const existing = await repo.findByCodeIncludingDeleted(ctx.tenantId, body.segmentCode);
    if (existing) {
      throw new HttpError(409, SEGMENT_ERROR_CODES.exists, "a segment with this segmentCode already exists");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSegment(ctx, body));
  });

  app.get("/v1/crm/segments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listSegmentsQuery.parse(req.query ?? {});
    const result = await queries.listSegments(ctx.tenantId, q.page, q.pageSize, {
      ...(q.status ? { status: q.status } : {}),
      ...(q.governance ? { governance: q.governance } : {}),
    });
    sendValidated(reply, segmentsListSchema, result);
  });

  // Declared before /:segmentCode so the intent is obvious to a reader; Fastify's
  // router prefers the static segment regardless of registration order.
  app.get("/v1/crm/segments/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: await queries.getSettings(ctx.tenantId) });
  });

  app.put("/v1/crm/segments/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = segmentSettingsBody.parse(req.body);
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.setSegmentSettings(ctx, body.enforceSegmentCatalogue),
    );
  });

  app.get("/v1/crm/segments/:segmentCode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { segmentCode } = segmentCodeParam.parse(req.params);
    return reply.send({ data: await loadOr404(ctx.tenantId, segmentCode) });
  });

  /**
   * The seam a later item consumes (recommendation-service). Published segments only:
   * a draft must not drive recommendations and a deprecated one must stop doing so, so
   * both answer 404 — "no eligibility is defined for this code" is one answer from a
   * consumer's point of view.
   */
  app.get("/v1/crm/segments/:segmentCode/eligibility", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { segmentCode } = segmentCodeParam.parse(req.params);
    const eligibility = await queries.getEligibility(ctx.tenantId, segmentCode);
    if (!eligibility) {
      throw new HttpError(404, SEGMENT_ERROR_CODES.notFound, "no published segment definition for this segmentCode");
    }
    sendValidated(reply, eligibilityResponseSchema, { data: eligibility });
  });

  app.patch("/v1/crm/segments/:segmentCode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { segmentCode } = segmentCodeParam.parse(req.params);
    const body = updateSegmentBody.parse(req.body);
    const segment = await loadOr404(ctx.tenantId, segmentCode);
    assertMutable(segment);
    // Optimistic locking answered synchronously: the consumer's UPDATE is guarded on
    // the same version, but a caller deserves the 409 now rather than a 202 that turns
    // into a silent no-op.
    if (segment.version !== body.version) {
      throw new HttpError(
        409,
        SEGMENT_ERROR_CODES.versionConflict,
        `segment has been modified; expected version ${segment.version}`,
      );
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateSegment(ctx, segmentCode, body));
  });

  app.delete("/v1/crm/segments/:segmentCode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { segmentCode } = segmentCodeParam.parse(req.params);
    const segment = await loadOr404(ctx.tenantId, segmentCode);
    assertMutable(segment);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteSegment(ctx, segmentCode));
  });

  app.post("/v1/crm/segments/:segmentCode/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { segmentCode } = segmentCodeParam.parse(req.params);
    const segment = await loadOr404(ctx.tenantId, segmentCode);
    assertMutable(segment);
    if (!canPublish(segment.status)) {
      throw new HttpError(422, SEGMENT_ERROR_CODES.alreadyPublished, "segment is already published");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.publishSegment(ctx, segmentCode));
  });

  app.post("/v1/crm/segments/:segmentCode/deprecate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { segmentCode } = segmentCodeParam.parse(req.params);
    const segment = await loadOr404(ctx.tenantId, segmentCode);
    assertMutable(segment);
    if (!canDeprecate(segment.status)) {
      throw new HttpError(
        422,
        segment.status === "deprecated" ? SEGMENT_ERROR_CODES.alreadyDeprecated : SEGMENT_ERROR_CODES.notPublished,
        "only a published segment can be deprecated",
      );
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.deprecateSegment(ctx, segmentCode));
  });
}
