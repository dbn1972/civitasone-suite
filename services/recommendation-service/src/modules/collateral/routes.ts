import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as nbaRepo from "../nba/repo.js";
import { COLLATERAL_TYPES, nextOrdinal, validateCollateral } from "./domain.js";

const READ_ROLES = ["recommendation_admin", "crm_user", "sales_user", "super_admin"];
const WRITE_ROLES = ["recommendation_admin", "sales_user", "super_admin"];

const MAX_LIMIT = 200;

const idParam = z.object({ id: z.string().uuid() });
const linkParam = z.object({ linkId: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const attachBody = z.object({
  collateralType: z.enum(["document", "video", "brochure", "case_study", "pricing_sheet"]),
  collateralRef: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(256),
  ordinal: z.number().int().min(0).optional(),
});

export async function collateralRoutes(app: FastifyInstance): Promise<void> {
  /** GET /v1/recommendations/:id/collateral — the deck, ordered by ordinal. */
  app.get("/v1/recommendations/:id/collateral", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByRecommendation(ctx.tenantId, id, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  /**
   * POST /v1/recommendations/:id/collateral — attach collateral.
   * CQRS write: validated, published as a command, answered 202. The consumer
   * performs the insert and emits the audit event.
   */
  app.post("/v1/recommendations/:id/collateral", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = attachBody.parse(req.body);

    const validationError = validateCollateral({
      collateralType: body.collateralType,
      collateralRef: body.collateralRef,
      title: body.title,
      ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
    });
    if (validationError) throw new HttpError(422, "COLLATERAL_INVALID", validationError);

    const recommendation = await nbaRepo.findById(id, ctx.tenantId);
    if (!recommendation) throw new HttpError(404, "NOT_FOUND", "recommendation not found");

    // Resolved on the read side so the ordinal is stable in the command payload
    // and the consumer stays a pure writer.
    const existing = await repo.listAllForRecommendation(ctx.tenantId, id);
    const ordinal = body.ordinal ?? nextOrdinal(existing);

    return reply.code(202).send(
      await commands.attachCollateral(ctx, {
        recommendationId: id,
        collateralType: body.collateralType,
        collateralRef: body.collateralRef,
        title: body.title,
        ordinal,
      }),
    );
  });

  /** DELETE /v1/recommendations/collateral/:linkId — detach collateral. */
  app.delete("/v1/recommendations/collateral/:linkId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { linkId } = linkParam.parse(req.params);

    const existing = await repo.findById(linkId, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "collateral link not found");

    return reply.code(202).send(await commands.detachCollateral(ctx, linkId));
  });

  /** GET /v1/recommendations/collateral/types — supported collateral kinds. */
  app.get("/v1/recommendations/collateral/types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: { collateralTypes: COLLATERAL_TYPES } });
  });
}
