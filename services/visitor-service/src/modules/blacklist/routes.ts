import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { blacklistAddBody, watchlistAddBody, idParam, listBlacklistQuery, listWatchlistQuery } from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// Blacklist/watchlist are security- and PII-sensitive lists (Requirement
// 10.1, 10.2): unlike modules/location (reference/config data readable by
// any `employee`), reads here are restricted to the same staff roles that
// can write, plus `protocol_officer` (who needs visibility into watchlist
// flags per Requirement 10.5 without being able to create/approve entries).
const READ_ROLES = ["security_admin", "protocol_officer", "tenant_admin", "super_admin"];
const WRITE_ROLES = ["security_admin", "tenant_admin", "super_admin"];

export async function blacklistRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/visitor/blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listBlacklistQuery.parse(req.query);
    const rows = await repo.listBlacklistEntries(ctx.tenantId, query, { actorId: ctx.actorId, correlationId: ctx.correlationId });
    return reply.send({ data: rows });
  });

  app.post("/v1/visitor/blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = blacklistAddBody.parse(req.body);
    // zod's `.nullable().optional()` fields carry an explicit `| undefined`
    // arm (exactOptionalPropertyTypes-incompatible with commands.ts's plain
    // `T | null` optional fields) — rebuild the object omitting any
    // undefined-valued optional keys, matching the convention used in
    // modules/check-in/consumer.ts.
    const accepted = await commands.blacklistAdd(ctx, {
      personName: body.personName,
      reason: body.reason,
      ...(body.locationId !== undefined ? { locationId: body.locationId } : {}),
      ...(body.identityDocType !== undefined ? { identityDocType: body.identityDocType } : {}),
      ...(body.identityDocNumber !== undefined ? { identityDocNumber: body.identityDocNumber } : {}),
      ...(body.effectiveFrom !== undefined ? { effectiveFrom: body.effectiveFrom } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });

  app.post("/v1/visitor/blacklist/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const entry = await repo.getBlacklistEntryById(ctx.tenantId, id, { actorId: ctx.actorId, correlationId: ctx.correlationId });
    if (!entry) throw new HttpError(404, "NOT_FOUND", "blacklist entry not found");
    const accepted = await commands.blacklistApprove(ctx, { entryId: id });
    return reply.code(202).send({ data: accepted });
  });

  // Fix 3: previously there was no way to lift/remove a blacklist entry at
  // all — only add/approve existed. Same WRITE_ROLES + 404-on-missing
  // pattern as the approve route above; the maker-checker distinct-actor
  // rule and the pending->active->archived state-machine check are
  // enforced in the consumer (domain.ts#assertDistinctMakerChecker /
  // assertBlacklistTransition), matching how approve delegates the same
  // checks rather than duplicating them at the route layer.
  app.post("/v1/visitor/blacklist/:id/deactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const entry = await repo.getBlacklistEntryById(ctx.tenantId, id, { actorId: ctx.actorId, correlationId: ctx.correlationId });
    if (!entry) throw new HttpError(404, "NOT_FOUND", "blacklist entry not found");
    const accepted = await commands.blacklistDeactivate(ctx, { entryId: id });
    return reply.code(202).send({ data: accepted });
  });

  app.get("/v1/visitor/watchlist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listWatchlistQuery.parse(req.query);
    const rows = await repo.listWatchlistEntries(ctx.tenantId, query, { actorId: ctx.actorId, correlationId: ctx.correlationId });
    return reply.send({ data: rows });
  });

  app.post("/v1/visitor/watchlist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = watchlistAddBody.parse(req.body);
    // See the equivalent comment in the blacklist POST handler above.
    const accepted = await commands.watchlistAdd(ctx, {
      personName: body.personName,
      ...(body.locationId !== undefined ? { locationId: body.locationId } : {}),
      ...(body.identityDocType !== undefined ? { identityDocType: body.identityDocType } : {}),
      ...(body.identityDocNumber !== undefined ? { identityDocNumber: body.identityDocNumber } : {}),
      ...(body.riskLevel !== undefined ? { riskLevel: body.riskLevel } : {}),
      ...(body.specialInstructions !== undefined ? { specialInstructions: body.specialInstructions } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });
}
