/**
 * PC-001 — governed versioned product master with approval (maker-checker).
 *
 * CQRS note: the write is committed together with its outbox event inside one
 * transaction. The outbox relay is what performs `queue.publish(...)`, so the
 * command is durably queued the moment the transaction commits — there is no
 * dual-write hole. Command endpoints answer 202 Accepted to reflect that the
 * downstream fan-out (audit, analytics, notification) is asynchronous.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as productRepo from "./repo.js";
import * as repo from "./governance-repo.js";
import {
  validateVersionTransition,
  checkMakerChecker,
  nextVersionNumber,
  MIN_REJECTION_REASON_LENGTH,
} from "./version-domain.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "super_admin"];
const APPROVER_ROLES = ["catalogue_approver", "catalogue_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });
const versionIdParam = z.object({ versionId: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const openVersionBody = z.object({
  changeSummary: z.string().min(1).max(2000),
});

const rejectBody = z.object({
  reason: z.string().min(MIN_REJECTION_REASON_LENGTH).max(2000),
});

const decisionBody = z.object({
  comment: z.string().max(2000).optional(),
});

export async function productVersionRoutes(app: FastifyInstance): Promise<void> {
  // ─── Version history ─────────────────────────────────────────────────────────
  app.get("/v1/catalogue/products/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

    const { rows, total } = await repo.listVersions(id, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows, meta: { page, pageSize: q.limit, total } });
  });

  // ─── Open a new draft version ────────────────────────────────────────────────
  app.post("/v1/catalogue/products/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = openVersionBody.parse(req.body);

    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

    // Only one open (non-terminal) version at a time, otherwise two makers could
    // race two drafts of the same product through approval independently.
    const existing = await repo.listVersions(id, ctx.tenantId, 200, 0);
    const open = existing.rows.find((v) => v.status === "draft" || v.status === "pending_approval");
    if (open) {
      throw new HttpError(422, "VERSION_ALREADY_OPEN", `Version ${open.versionNumber} is still '${open.status}'; close it before opening another`);
    }

    const versionNumber = nextVersionNumber(await repo.listVersionNumbers(id, ctx.tenantId));
    const versionId = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insertVersion(tx, {
        id: versionId,
        tenantId: ctx.tenantId,
        productId: id,
        versionNumber,
        status: "draft",
        changeSummary: body.changeSummary,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.productVersionOpened,
        eventType: EVENTS.productVersionOpened,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { productId: id, versionId, versionNumber, status: "draft", changeSummary: body.changeSummary },
      });
    });

    return reply.code(202).send({ data: { id: versionId, productId: id, versionNumber, status: "draft" } });
  });

  // ─── Submit: draft → pending_approval ────────────────────────────────────────
  app.post("/v1/catalogue/products/versions/:versionId/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { versionId } = versionIdParam.parse(req.params);
    decisionBody.parse(req.body ?? {});

    const version = await repo.findVersionById(versionId, ctx.tenantId);
    if (!version) throw new HttpError(404, "NOT_FOUND", "Product version not found");

    const check = validateVersionTransition(version.status, "pending_approval");
    if (!check.valid) throw new HttpError(422, "INVALID_TRANSITION", check.reason ?? "Invalid transition");

    await db.transaction(async (tx) => {
      const ok = await repo.updateVersionStatus(tx, versionId, ctx.tenantId, {
        status: "pending_approval",
        submittedAt: new Date(),
        submittedBy: ctx.actorId,
        updatedBy: ctx.actorId,
      }, version.version);
      if (!ok) throw new HttpError(409, "VERSION_CONFLICT", "Product version has been modified; retry with current state");

      await enqueue(tx, {
        topic: EVENTS.productVersionSubmitted,
        eventType: EVENTS.productVersionSubmitted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { productId: version.productId, versionId, versionNumber: version.versionNumber, status: "pending_approval" },
      });
    });

    return reply.code(202).send({ data: { id: versionId, status: "pending_approval" } });
  });

  // ─── Approve: pending_approval → approved (maker-checker enforced) ───────────
  app.post("/v1/catalogue/products/versions/:versionId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { versionId } = versionIdParam.parse(req.params);
    const body = decisionBody.parse(req.body ?? {});

    const version = await repo.findVersionById(versionId, ctx.tenantId);
    if (!version) throw new HttpError(404, "NOT_FOUND", "Product version not found");

    const transition = validateVersionTransition(version.status, "approved");
    if (!transition.valid) throw new HttpError(422, "INVALID_TRANSITION", transition.reason ?? "Invalid transition");

    // Separation of duties: the maker can never be the checker. 422 not 403 —
    // the caller holds the approver role, the business rule is what forbids it.
    const maker = checkMakerChecker(version.createdBy, ctx.actorId);
    if (!maker.valid) throw new HttpError(422, "MAKER_CHECKER_VIOLATION", maker.reason ?? "Maker cannot be checker");

    await db.transaction(async (tx) => {
      const ok = await repo.updateVersionStatus(tx, versionId, ctx.tenantId, {
        status: "approved",
        approvedBy: ctx.actorId,
        approvedAt: new Date(),
        updatedBy: ctx.actorId,
      }, version.version);
      if (!ok) throw new HttpError(409, "VERSION_CONFLICT", "Product version has been modified; retry with current state");

      await enqueue(tx, {
        topic: EVENTS.productVersionApproved,
        eventType: EVENTS.productVersionApproved,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          productId: version.productId,
          versionId,
          versionNumber: version.versionNumber,
          status: "approved",
          makerId: version.createdBy,
          checkerId: ctx.actorId,
          ...(body.comment !== undefined ? { comment: body.comment } : {}),
        },
      });
    });

    return reply.code(202).send({ data: { id: versionId, status: "approved" } });
  });

  // ─── Reject: pending_approval → rejected (reason required) ───────────────────
  app.post("/v1/catalogue/products/versions/:versionId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { versionId } = versionIdParam.parse(req.params);
    const body = rejectBody.parse(req.body);

    const version = await repo.findVersionById(versionId, ctx.tenantId);
    if (!version) throw new HttpError(404, "NOT_FOUND", "Product version not found");

    const transition = validateVersionTransition(version.status, "rejected");
    if (!transition.valid) throw new HttpError(422, "INVALID_TRANSITION", transition.reason ?? "Invalid transition");

    const maker = checkMakerChecker(version.createdBy, ctx.actorId);
    if (!maker.valid) throw new HttpError(422, "MAKER_CHECKER_VIOLATION", maker.reason ?? "Maker cannot be checker");

    await db.transaction(async (tx) => {
      const ok = await repo.updateVersionStatus(tx, versionId, ctx.tenantId, {
        status: "rejected",
        rejectionReason: body.reason,
        rejectedBy: ctx.actorId,
        rejectedAt: new Date(),
        updatedBy: ctx.actorId,
      }, version.version);
      if (!ok) throw new HttpError(409, "VERSION_CONFLICT", "Product version has been modified; retry with current state");

      await enqueue(tx, {
        topic: EVENTS.productVersionRejected,
        eventType: EVENTS.productVersionRejected,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          productId: version.productId,
          versionId,
          versionNumber: version.versionNumber,
          status: "rejected",
          reason: body.reason,
          makerId: version.createdBy,
          checkerId: ctx.actorId,
        },
      });
    });

    return reply.code(202).send({ data: { id: versionId, status: "rejected" } });
  });
}
