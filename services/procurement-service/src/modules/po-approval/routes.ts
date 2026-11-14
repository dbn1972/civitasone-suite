/**
 * M10: procurement without Finance -- local PO approval.
 *
 *   GET   /v1/procurement/po-approval-settings   the mode (and where it comes from) and the threshold matrix
 *   PUT   /v1/procurement/po-approval-settings   set the mode override and / or replace the matrix (admins; audited)
 *   PATCH /v1/procurement/pos/:id/approve        approve a PO under the matrix (local mode only)
 *
 * A tenant on the finance-sanction path never gets past the mode check:
 * approve answers 409 and its POs keep being approved through the workflow task.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as poRepo from "../po/repo.js";
import { assertTransitionAllowed, DomainError as PoDomainError } from "../po/domain.js";
import { idParam } from "../po/validators.js";
import { approvalDecision, validateMatrix, wireBands, type MatrixBand } from "./matrix.js";
import { resolveApprovalModeDetail } from "./mode.js";
import { loadMatrix, loadPending } from "./repo.js";
import { tenantHasModule } from "../../shared/tenant-modules.js";

const PROC_ROLES = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];
const CONFIG_ROLES = ["procurement_admin", "super_admin"];
const AUDIT_TOPIC = "audit.event.record";

export const LOCAL_APPROVAL_NOT_ENABLED = "LOCAL_APPROVAL_NOT_ENABLED";
export const APPROVAL_LEVEL_INSUFFICIENT = "APPROVAL_LEVEL_INSUFFICIENT";
export const LOCAL_OVERRIDE_REQUIRES_SUPER_ADMIN = "LOCAL_OVERRIDE_REQUIRES_SUPER_ADMIN";

const bandBody = z.object({
  upToMinor: z.string().regex(/^[1-9][0-9]{0,17}$/, "a whole number of paise").nullable(),
  approverRoles: z.array(z.string().trim().min(1)).min(1).max(5),
});
export const settingsBody = z.object({
  modeOverride: z.enum(["finance_sanction", "local"]).nullable().optional(),
  matrix: z.array(bandBody).min(1).max(10).optional(),
}).refine((b) => b.modeOverride !== undefined || b.matrix !== undefined, { message: "send modeOverride and / or matrix" });
const approveBody = z.object({ reason: z.string().trim().min(3).max(500).optional() });

export const parseBands = (b: z.infer<typeof bandBody>[]): MatrixBand[] => b.map((x) => ({ upToMinor: x.upToMinor === null ? null : BigInt(x.upToMinor), approverRoles: x.approverRoles }));

export async function poApprovalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/po-approval-settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const [d, m, pending] = await Promise.all([resolveApprovalModeDetail(ctx.tenantId), loadMatrix(ctx.tenantId), loadPending(ctx.tenantId)]);
    return reply.send({ mode: d.mode, source: d.source, override: d.override, hasFinance: d.hasFinance, matrix: wireBands(m.bands), isDefaultMatrix: m.isDefault, pendingOverride: pending });
  });

  app.put("/v1/procurement/po-approval-settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const body = settingsBody.parse(req.body);
    if (body.matrix) {
      const problems = validateMatrix(parseBands(body.matrix));
      if (problems.length > 0) throw new HttpError(400, "INVALID_MATRIX", problems.join("; "));
    }
    // Forcing local approval on a tenant that HAS Finance drops its sanction rule, the finance budget check and the workflow
    // task. One procurement admin may not do that: it needs a super admin, and a second, different super admin to confirm
    // it (the consumer holds the request pending until then). The safe direction (back to the sanction path) stays open.
    const superAdmin = ctx.roles.includes("super_admin");
    if (body.modeOverride === "local" && !superAdmin && (await tenantHasModule(ctx.tenantId, "finance"))) {
      throw new HttpError(403, LOCAL_OVERRIDE_REQUIRES_SUPER_ADMIN, "switching a tenant that has Finance to local approval drops its budget-sanction rule; it needs a super admin, confirmed by a second super admin");
    }
    await queue.publish(COMMANDS.poApprovalSettingsUpdate, {
      messageId: randomUUID(), type: COMMANDS.poApprovalSettingsUpdate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, ...(superAdmin ? { superAdmin: true } : {}), ...(body.modeOverride !== undefined ? { modeOverride: body.modeOverride } : {}), ...(body.matrix ? { matrix: body.matrix } : {}) },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: ctx.tenantId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.patch("/v1/procurement/pos/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveBody.parse(req.body ?? {});

    const po = await poRepo.findPoById(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "purchase order not found");

    const denied = async (code: string, status: string, extra: Record<string, unknown> = {}) => {
      // A refused attempt is itself audited (outcome "denied"), like the payroll maker-checker refusals.
      await queue.publish(AUDIT_TOPIC, {
        messageId: randomUUID(), type: AUDIT_TOPIC,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
        payload: { service: "procurement", action: "approve", resourceType: "po", resourceId: id, outcome: "denied", denialCode: code, status, path: "local", ...extra },
      });
    };

    const mode = await resolveApprovalModeDetail(ctx.tenantId);
    if (mode.mode !== "local") {
      throw new HttpError(409, LOCAL_APPROVAL_NOT_ENABLED, "this tenant approves purchase orders through the finance-sanction workflow; local approval is not enabled");
    }
    try {
      assertTransitionAllowed(po.status ?? "draft", "approved");
    } catch (err) {
      if (err instanceof PoDomainError) throw new HttpError(409, "INVALID_STATE_TRANSITION", `a ${po.status ?? "draft"} purchase order cannot be approved`);
      throw err;
    }
    // Maker-checker: nobody approves a purchase order they created.
    if (po.createdBy === ctx.actorId) {
      await denied("SOD_VIOLATION", po.status ?? "draft");
      throw new HttpError(403, "SOD_VIOLATION", "maker and checker must be different actors (self-approval rejected)");
    }
    // Threshold matrix: the approver's role must be one the PO's value band allows.
    const matrix = await loadMatrix(ctx.tenantId);
    const decision = approvalDecision(BigInt(po.totalMinor), ctx.roles, matrix.bands);
    if (!decision.ok) {
      await denied(APPROVAL_LEVEL_INSUFFICIENT, po.status ?? "draft", { requiredRoles: decision.requiredRoles, totalMinor: String(po.totalMinor) });
      throw new HttpError(403, APPROVAL_LEVEL_INSUFFICIENT, `a purchase order of this value must be approved by: ${decision.requiredRoles.join(", ")}`);
    }
    const messageId = randomUUID();
    await queue.publish(COMMANDS.poApprove, {
      messageId, type: COMMANDS.poApprove,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      // approverRoles are the caller's own roles from the verified token; the consumer re-checks the matrix with them.
      payload: { id, tenantId: ctx.tenantId, localApproval: { ...(body.reason ? { reason: body.reason } : {}), approverRoles: ctx.roles } },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });
}
