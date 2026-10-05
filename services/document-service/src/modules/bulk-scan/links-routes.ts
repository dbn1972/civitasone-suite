/** Link queue, maker-checker decisions, unlink and target lookup. Writes publish commands only (CQRS). */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { BULK_SCAN_ROLES, installBulkScanErrorHandler } from "./http.js";
import { linksQuery, linkParam, linkRejectBody, unlinkBody, lookupQuery } from "./review-validators.js";
import * as repo from "./repo.js";
import * as rrepo from "./review-repo.js";
import * as commands from "./review-commands.js";
import { lookupTarget } from "./lookup-client.js";

const P = "/v1/documents/bulk-scan";

export async function linksRoutes(app: FastifyInstance): Promise<void> {
  app.get(`${P}/links`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const q = linksQuery.parse(req.query);
    const { rows, total } = await rrepo.listLinks(ctx.tenantId, q);
    return reply.send({
      data: rows.map((l) => ({
        linkId: l.id, fileId: l.fileId, documentId: l.documentId, target: l.target, targetId: l.targetId, state: l.state,
        requestedBy: l.requestedBy, approvedBy: l.approvedBy,
        // `reason` = the target's reason CODE when it gave one, else the free-text note the user typed; both always available below
        reason: l.resultReason ?? l.reason, note: l.reason, resultReason: l.resultReason, detail: l.resultDetail ?? null, createdAt: l.createdAt,
      })),
      pagination: { total, limit: q.limit, offset: q.offset },
    });
  });

  app.post(`${P}/links/:linkId/approve`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { linkId } = linkParam.parse(req.params);
    const l = await rrepo.getLink(ctx.tenantId, linkId);
    if (!l) throw new HttpError(404, "NOT_FOUND", "link not found");
    if (l.state !== "awaiting_approval") throw new HttpError(409, "NOT_PENDING", `link is ${l.state}`);
    if (l.requestedBy === ctx.actorId) throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "a different user must approve this link");
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveLink(ctx, linkId));
  });

  app.post(`${P}/links/:linkId/reject`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { linkId } = linkParam.parse(req.params);
    const body = linkRejectBody.parse(req.body);
    const l = await rrepo.getLink(ctx.tenantId, linkId);
    if (!l) throw new HttpError(404, "NOT_FOUND", "link not found");
    if (l.state !== "awaiting_approval" && l.state !== "flagged_mismatch") throw new HttpError(409, "NOT_PENDING", `link is ${l.state}`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectLink(ctx, linkId, body.reason));
  });

  app.post(`${P}/links/:linkId/unlink-request`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { linkId } = linkParam.parse(req.params);
    const body = unlinkBody.parse(req.body);
    const l = await rrepo.getLink(ctx.tenantId, linkId);
    if (!l) throw new HttpError(404, "NOT_FOUND", "link not found");
    if (l.state !== "linked") throw new HttpError(409, "NOT_LINKED", `link is ${l.state}`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.unlinkLink(ctx, linkId, body.reason));
  });

  // Candidates from the target service (read-only, honours the tenant's allowed targets). Never fails because a target is down.
  app.get(`${P}/link-lookup`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const q = lookupQuery.parse(req.query);
    const eff = await repo.resolveEffectiveSettings(ctx.tenantId);
    if (!eff.settings.allowedLinkTargets.includes(q.target)) throw new HttpError(422, "LINK_TARGET_NOT_ALLOWED", "link target is not enabled for this tenant");
    const r = await lookupTarget(ctx, { target: q.target, q: q.q, amountMinor: q.amountMinor });
    return reply.send({ data: r.data, ...(r.error ? { error: r.error } : {}) });
  });

  installBulkScanErrorHandler(app);
}
