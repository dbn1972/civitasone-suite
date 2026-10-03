/**
 * GAP-ADMIN-ONBOARDING-05/-07, GAP-ADMIN-OPERATORS-06: the platform onboarding
 * queue and the audited export / PII-reveal endpoints for the platform-operator
 * screens. Routes never write the database: they validate, read, and publish a
 * command that the consumer applies in a transaction with its audit event.
 */
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { ONBOARDING_STAGES, PLATFORM_AUDIT_RESOURCES, canTransition, maskedContact, type OnboardingStage } from "./domain.js";
import type { OnboardingRequestRow } from "./schema.js";

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const exportBody = z.object({
  resource: z.enum(PLATFORM_AUDIT_RESOURCES),
  rowCount: z.number().int().min(0).max(100_000),
  filtered: z.boolean().optional(),
});
const createBody = z.object({
  orgName: z.string().trim().min(2).max(200),
  contactName: z.string().trim().min(1).max(200),
  contactEmail: z.string().trim().email().max(254),
  notes: z.string().trim().max(2000).optional(),
});
const moveBody = z.object({
  from: z.enum(ONBOARDING_STAGES),
  to: z.enum(ONBOARDING_STAGES),
  assignedTo: z.string().uuid().nullable().optional(),
  assignedToName: z.string().trim().max(200).nullable().optional(),
  provisionedTenantId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(500).optional(),
}).superRefine((b, ctx) => {
  // Each field is only meaningful on one move: the tenant that was provisioned is recorded when the
  // request completes, an assignee when work starts. A reason is required to close a request unsuccessfully.
  if (b.provisionedTenantId !== undefined && b.to !== "completed") {
    ctx.addIssue({ code: "custom", path: ["provisionedTenantId"], message: "only accepted when moving to completed" });
  }
  if ((b.assignedTo !== undefined || b.assignedToName !== undefined) && b.to !== "in progress") {
    ctx.addIssue({ code: "custom", path: ["assignedTo"], message: "only accepted when moving to in progress" });
  }
  if ((b.to === "rejected" || b.to === "cancelled") && (b.note ?? "").length < 3) {
    ctx.addIssue({ code: "custom", path: ["note"], message: "a reason of at least 3 characters is required to reject or cancel" });
  }
});
const revealBody = z.object({ reason: z.string().trim().min(3).max(500) });

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new HttpError(400, "VALIDATION_FAILED", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

/** The row as the queue screen shows it: contact is masked, never the clear value. */
function view(r: OnboardingRequestRow) {
  return {
    id: r.id,
    org: r.orgName,
    contact: maskedContact(r.contactName, r.contactEmail),
    requested: r.requestedAt.toISOString(),
    assigned: r.assignedToName ?? "",
    stage: r.stage,
    provisionedTenantId: r.provisionedTenantId,
    version: r.version,
  };
}

export async function platformOpsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/onboarding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const q = parse(listQuery, req.query);
    const { rows, total } = await repo.listOnboarding(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows.map(view), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/admin/onboarding/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = parse(idParam, req.params);
    const row = await repo.findOnboarding(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "onboarding request not found");
    return reply.send({ data: view(row) });
  });

  app.post("/v1/admin/onboarding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createOnboardingRequest(ctx, parse(createBody, req.body)));
  });

  app.patch("/v1/admin/onboarding/:id/stage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = parse(idParam, req.params);
    const body = parse(moveBody, req.body);
    if (!canTransition(body.from, body.to)) {
      throw new HttpError(409, "ILLEGAL_TRANSITION", `cannot move an onboarding request from "${body.from}" to "${body.to}"`);
    }
    // Courtesy pre-check so the operator gets a synchronous 409 for a stale view; the consumer re-applies it atomically.
    const row = await repo.findOnboarding(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "onboarding request not found");
    if (row.stage !== body.from) {
      throw new HttpError(409, "STAGE_CHANGED", `request is now "${row.stage}"; refresh and try again`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.moveOnboardingStage(ctx, { requestId: id, ...body }));
  });

  // Audited reveal of the clear contact. Fail closed: the value is returned only
  // after the audit command was accepted by the queue.
  app.post("/v1/admin/onboarding/:id/reveal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(revealBody, req.body);
    const row = await repo.findOnboarding(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "onboarding request not found");
    await commands.recordDataAccess(ctx, { kind: "reveal", resource: "onboarding", resourceId: id, reason, fields: ["contactName", "contactEmail"] });
    return reply.send({ data: { id, contactName: row.contactName, contactEmail: row.contactEmail } });
  });

  // Audit record for a CSV export built in the browser. The web client calls this
  // BEFORE building the file and aborts the download when it fails.
  app.post("/v1/admin/platform-exports/audit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const b = parse(exportBody, req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordDataAccess(ctx, {
      kind: "export", resource: b.resource, rowCount: b.rowCount, filtered: b.filtered === true,
    }));
  });
}
