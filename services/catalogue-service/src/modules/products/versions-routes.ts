/**
 * PC-001 — governed versioned product master with approval (maker-checker).
 * Mutations publish commands and return 202 Accepted.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as productRepo from "./repo.js";
import * as repo from "./governance-repo.js";
import {
  validateVersionTransition,
  checkMakerChecker,
  nextVersionNumber,
  MIN_REJECTION_REASON_LENGTH,
} from "./version-domain.js";
import * as commands from "./commands.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "super_admin"];
const APPROVER_ROLES = ["catalogue_approver", "catalogue_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });
const versionIdParam = z.object({ versionId: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const openVersionBody = z.object({ changeSummary: z.string().min(1).max(2000) });
const rejectBody = z.object({ reason: z.string().min(MIN_REJECTION_REASON_LENGTH).max(2000) });
const decisionBody = z.object({ comment: z.string().max(2000).optional() });

export async function productVersionRoutes(app: FastifyInstance): Promise<void> {
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

  app.post("/v1/catalogue/products/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = openVersionBody.parse(req.body);
    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");
    const existing = await repo.listVersions(id, ctx.tenantId, 200, 0);
    const open = existing.rows.find((v) => v.status === "draft" || v.status === "pending_approval");
    if (open) {
      throw new HttpError(422, "VERSION_ALREADY_OPEN", `Version ${open.versionNumber} is still '${open.status}'; close it before opening another`);
    }
    const versionNumber = nextVersionNumber(await repo.listVersionNumbers(id, ctx.tenantId));
    return reply.code(202).send(
      await commands.openProductVersion(ctx, id, { changeSummary: body.changeSummary, versionNumber }),
    );
  });

  app.post("/v1/catalogue/products/versions/:versionId/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { versionId } = versionIdParam.parse(req.params);
    decisionBody.parse(req.body ?? {});
    const version = await repo.findVersionById(versionId, ctx.tenantId);
    if (!version) throw new HttpError(404, "NOT_FOUND", "Product version not found");
    const check = validateVersionTransition(version.status, "pending_approval");
    if (!check.valid) throw new HttpError(422, "INVALID_TRANSITION", check.reason ?? "Invalid transition");
    return reply.code(202).send(
      await commands.submitProductVersion(ctx, versionId, {
        productId: version.productId,
        versionNumber: version.versionNumber,
        version: version.version,
        submittedAt: new Date().toISOString(),
      }),
    );
  });

  app.post("/v1/catalogue/products/versions/:versionId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { versionId } = versionIdParam.parse(req.params);
    const body = decisionBody.parse(req.body ?? {});
    const version = await repo.findVersionById(versionId, ctx.tenantId);
    if (!version) throw new HttpError(404, "NOT_FOUND", "Product version not found");
    const transition = validateVersionTransition(version.status, "approved");
    if (!transition.valid) throw new HttpError(422, "INVALID_TRANSITION", transition.reason ?? "Invalid transition");
    const maker = checkMakerChecker(version.createdBy, ctx.actorId);
    if (!maker.valid) throw new HttpError(422, "MAKER_CHECKER_VIOLATION", maker.reason ?? "Maker cannot be checker");
    return reply.code(202).send(
      await commands.approveProductVersion(ctx, versionId, {
        productId: version.productId,
        versionNumber: version.versionNumber,
        version: version.version,
        makerId: version.createdBy,
        comment: body.comment ?? null,
        approvedAt: new Date().toISOString(),
      }),
    );
  });

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
    return reply.code(202).send(
      await commands.rejectProductVersion(ctx, versionId, {
        productId: version.productId,
        versionNumber: version.versionNumber,
        version: version.version,
        makerId: version.createdBy,
        reason: body.reason,
        rejectedAt: new Date().toISOString(),
      }),
    );
  });
}
