/** Settings (maker-checker) and scan-profile routes. Writes publish commands only (CQRS). */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { BULK_SCAN_ROLES, SUPER_ADMIN_ROLES, installBulkScanErrorHandler } from "./http.js";
import { putSettingsBody, approveChangeBody, rejectChangeBody, createProfileBody, updateProfileBody, deleteProfileQuery, idParam } from "./validators.js";
import { isSensitiveChange } from "./settings.js";
import { classifyChange, classifyProfileChange, needsApprovalDirection, settingsApplyDirectly } from "./change-classifier.js";
import { randomUUID } from "node:crypto";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

const P = "/v1/documents/bulk-scan";
/** 202 acknowledgement + whether the change waits for a second approver (id is then the CHANGE-REQUEST id) or was applied directly. */
const acceptedWithApproval = acceptedResponseSchema.extend({ requiresApproval: z.boolean() });
const withApproval = <T extends object>(a: T, requiresApproval: boolean): T & { requiresApproval: boolean } => ({ ...a, requiresApproval });
const crQuery = z.object({ status: z.enum(["pending", "approved", "rejected", "superseded"]).optional() });

export async function bulkScanSettingsRoutes(app: FastifyInstance): Promise<void> {
  // Effective settings (+ pending change requests)
  app.get(`${P}/settings`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    return reply.send(await queries.getSettings(ctx.tenantId));
  });

  // PUT creates a CHANGE REQUEST (maker-checker); nothing is applied until a different admin approves.
  app.put(`${P}/settings`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const body = putSettingsBody.parse(req.body);
    const cur = await repo.resolveEffectiveSettings(ctx.tenantId);
    if (isSensitiveChange(cur.settings, body.settings) && !body.reason) {
      throw new HttpError(422, "REASON_REQUIRED", "turning malware fail-closed or the filing maker-checker OFF requires a reason");
    }
    // Direction-aware (change-classifier.ts): a pure security tightening is applied immediately by the consumer; anything else waits for a checker.
    const direct = settingsApplyDirectly(classifyChange(cur.settings, body.settings));
    return sendAccepted(reply, acceptedWithApproval, withApproval(await commands.proposeSettings(ctx, body.settings, body.reason), !direct));
  });

  app.get(`${P}/settings/change-requests`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const q = crQuery.parse(req.query);
    return reply.send({ data: await queries.listChangeRequests(ctx.tenantId, q.status) });
  });

  app.post(`${P}/settings/change-requests/:id/approve`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveChangeBody.parse(req.body ?? {});
    const cr = await queries.getChangeRequest(ctx.tenantId, id);
    if (!cr) throw new HttpError(404, "NOT_FOUND", "change request not found");
    if (cr.status !== "pending") throw new HttpError(409, "NOT_PENDING", `change request is ${cr.status}`);
    if (cr.maker === ctx.actorId) throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "a different admin must approve your change");
    const isSuper = hasAnyRole(ctx, SUPER_ADMIN_ROLES);
    if (cr.sensitive && !isSuper) throw new HttpError(403, "SUPER_ADMIN_REQUIRED", "this is a sensitive change (security-relevant setting) and needs a super_admin approver");
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveSettingsChange(ctx, id, body.reason));
  });

  app.post(`${P}/settings/change-requests/:id/reject`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectChangeBody.parse(req.body);
    const cr = await queries.getChangeRequest(ctx.tenantId, id);
    if (!cr) throw new HttpError(404, "NOT_FOUND", "change request not found");
    if (cr.status !== "pending") throw new HttpError(409, "NOT_PENDING", `change request is ${cr.status}`);
    if (cr.maker === ctx.actorId) throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "a different admin must decide your change (withdraw is not supported)");
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectSettingsChange(ctx, id, body.reason));
  });

  // ── profiles ───────────────────────────────────────────────
  app.get(`${P}/profiles`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    return reply.send({ data: await queries.listProfiles(ctx.tenantId) });
  });

  app.get(`${P}/profiles/:id`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const p = await queries.getProfile(ctx.tenantId, id);
    if (!p) throw new HttpError(404, "NOT_FOUND", "profile not found");
    return reply.send(p);
  });

  app.post(`${P}/profiles`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { reason, ...body } = createProfileBody.parse(req.body);
    // A LOOSENING profile (lower threshold / margin / minScore, added cloud provider, widened chain) is maker-checker; tightening / neutral is direct.
    const base = (await repo.resolveEffectiveSettings(ctx.tenantId)).settings;
    if (needsApprovalDirection(classifyProfileChange(base, null, body.config))) {
      const change = { op: "create", name: body.name, description: body.description ?? null, config: body.config };
      return sendAccepted(reply, acceptedWithApproval, withApproval(await commands.proposeProfileChange(ctx, { profileId: randomUUID(), change, reason }), true));
    }
    return sendAccepted(reply, acceptedWithApproval, withApproval(await commands.createProfile(ctx, body), false));
  });

  app.put(`${P}/profiles/:id`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const { reason, ...body } = updateProfileBody.parse(req.body);
    const existing = await queries.getProfile(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "profile not found");
    const base = (await repo.resolveEffectiveSettings(ctx.tenantId)).settings;
    if (body.config !== undefined && needsApprovalDirection(classifyProfileChange(base, existing.config, body.config))) {
      const change = { op: "update", expectedVersion: body.expectedVersion, ...(body.name !== undefined ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description } : {}), config: body.config };
      return sendAccepted(reply, acceptedWithApproval, withApproval(await commands.proposeProfileChange(ctx, { profileId: id, change, reason }), true));
    }
    return sendAccepted(reply, acceptedWithApproval, withApproval(await commands.updateProfile(ctx, id, body), false));
  });

  app.delete(`${P}/profiles/:id`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const { reason } = deleteProfileQuery.parse(req.query);
    if (!(await queries.getProfile(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "profile not found");
    // deleting a profile that some batch still references needs a second approver; an unreferenced one is direct (audited)
    if (await repo.profileReferenced(ctx.tenantId, id)) {
      return sendAccepted(reply, acceptedWithApproval, withApproval(await commands.proposeProfileChange(ctx, { profileId: id, change: { op: "delete" }, reason }), true));
    }
    return sendAccepted(reply, acceptedWithApproval, withApproval(await commands.deleteProfile(ctx, id), false));
  });

  installBulkScanErrorHandler(app);
}
