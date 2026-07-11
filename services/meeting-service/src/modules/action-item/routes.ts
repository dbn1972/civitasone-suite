/**
 * action-item module — HTTP routes (Fastify plugin `actionItemRoutes`, 11 endpoints, task 11.3).
 *
 * Follows the suite CQRS + envelope conventions (structure.md) and mirrors the already-implemented
 * sibling routes (decision/routes.ts, voting/routes.ts, participant/routes.ts):
 *   • WRITES — `resolveContext` → `requireRole` → require `X-Idempotency-Key` → zod validate
 *              (action-item/validators.ts) → command publish (action-item/commands.ts) → 202
 *              `{ data: Accepted }`. Routes NEVER write to Postgres directly; the action-item
 *              consumer applies the change and emits the outbox events (Req 9.x, 10.x).
 *   • READS  — cache-first `repo.*` lookups (action-item/repo.ts) → 200 `{ data }`. A missing
 *              parent meeting / action item / committee 404s BEFORE any command is published.
 *   • ERRORS — the app-level `registerSchemaErrorHandler` maps zod → 400, `HttpError` → its status
 *              (401 unauthenticated / 403 forbidden / 404 not-found / 409 version-conflict /
 *              422 domain-rule, incl. `ACTION_ITEM_DEADLINE_INVALID`), unknown → 500.
 *
 * Idempotency (steering: API Design Standards): `X-Idempotency-Key` is REQUIRED on every write
 * (POST/PATCH that triggers a queued write). Surfaced on `ctx.idempotencyKey` by the auth context
 * resolver; a missing key is rejected 400 before any command is published.
 *
 * RBAC (design.md § Access Control Matrix, "Actions" column):
 *   • meeting_admin        — full control over every action-item operation.
 *   • committee_secretary  — Assign (records action items arising from a meeting), Update.
 *   • committee_chairperson — Verify (confirms submitted evidence → completed).
 *   • committee_member     — Update own + act on their own assignment (acknowledge/progress/
 *                            evidence). The self-scope (assignee == actor) is not enforced here at
 *                            the role gate; the consumer owns the per-row rules.
 *   • observer / special_invitee — ❌ no action-item access.
 * tenant_admin / super_admin are platform-wide. Reads are limited to the acting meeting roles.
 *
 * Endpoints (11):
 *   POST  /v1/meetings/:meetingId/action-items                assign an action item
 *   GET   /v1/meetings/:meetingId/action-items                list a meeting's action items
 *   PATCH /v1/meetings/action-items/:actionId                 update an action item
 *   POST  /v1/meetings/action-items/:actionId/acknowledge     acknowledge assignment
 *   POST  /v1/meetings/action-items/:actionId/progress        submit a progress update
 *   POST  /v1/meetings/action-items/:actionId/evidence        submit completion evidence
 *   POST  /v1/meetings/action-items/:actionId/verify          verify completion
 *   GET   /v1/meetings/action-items/my                        my assigned action items
 *   GET   /v1/meetings/action-items/overdue                   list overdue items (opt. committee)
 *   GET   /v1/meetings/committees/:committeeId/atr            generate the committee ATR
 *   GET   /v1/meetings/action-items/:actionId/history         progress history
 *
 * _Requirements: 9.1, 9.2, 9.7, 9.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  actionItemAssignSchema,
  actionItemUpdateSchema,
  actionItemAcknowledgeSchema,
  actionItemProgressSchema,
  actionItemEvidenceSchema,
  actionItemVerifySchema,
} from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// ─── RBAC role groups (design § Access Control Matrix, "Actions") ────────────

const ADMIN_ROLES = ["tenant_admin", "super_admin"];
/** Assign an action item — the secretariat records actions arising from a meeting (Req 9.1). */
const ASSIGN_ROLES = ["meeting_admin", "committee_secretary", ...ADMIN_ROLES];
/** Update an action item — secretariat + the assigned member ("Update own", Req 9.1). */
const UPDATE_ROLES = ["meeting_admin", "committee_secretary", "committee_member", ...ADMIN_ROLES];
/** Assignee self-actions — acknowledge / progress / evidence (Req 9.4, 9.7). */
const ASSIGNEE_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "employee",
  ...ADMIN_ROLES,
];
/** Verify completion — the chairperson confirms submitted evidence (Req 9.7). */
const VERIFY_ROLES = ["meeting_admin", "committee_chairperson", ...ADMIN_ROLES];
/** Read the action-item register / ATR — all acting meeting roles within the tenant. */
const READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "employee",
  ...ADMIN_ROLES,
];

// ─── Path-param + query schemas (validated at the boundary) ──────────────────
const meetingParam = z.object({ meetingId: z.string().uuid() });
const actionParam = z.object({ actionId: z.string().uuid() });
const committeeParam = z.object({ committeeId: z.string().uuid() });
/** Optional committee filter for the overdue listing. */
const overdueQuery = z.object({ committeeId: z.string().uuid().optional() });
/** ATR meeting window (Req 10.1, default 3, capped so the report stays bounded). */
const atrQuery = z.object({ meetings: z.coerce.number().int().positive().max(50).optional() });

/**
 * Enforce the mandatory `X-Idempotency-Key` on writes (steering: idempotency REQUIRED on all
 * POST/PATCH that trigger a queued write). Rejected as 400 before any command is published.
 */
function requireIdempotencyKey(ctx: RequestContext): void {
  if (!ctx.idempotencyKey || ctx.idempotencyKey.trim().length === 0) {
    throw new HttpError(400, "VALIDATION_FAILED", "X-Idempotency-Key header is required for this operation");
  }
}

/** 404 unless the parent meeting exists in the caller's tenant. */
async function assertMeetingExists(tenantId: string, meetingId: string): Promise<void> {
  const meeting = await repo.getMeetingRef(tenantId, meetingId);
  if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
}

/** 404 unless the action item exists in the caller's tenant; returns its reference. */
async function assertActionItemExists(tenantId: string, actionId: string): Promise<repo.ActionItemRef> {
  const item = await repo.getActionItemRef(tenantId, actionId);
  if (!item) throw new HttpError(404, "MEETING_NOT_FOUND", "action item not found");
  return item;
}

export async function actionItemRoutes(app: FastifyInstance): Promise<void> {
  // ── Assign an action item (Req 9.1) ──────────────────────────────────────
  app.post("/v1/meetings/:meetingId/action-items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSIGN_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingParam.parse(req.params);
    const body = actionItemAssignSchema.parse(req.body);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const accepted = await commands.actionItemAssign(ctx, meetingId, body);
    reply.header("location", `/v1/meetings/action-items/${accepted.id}/history`);
    return reply.code(202).send({ data: accepted });
  });

  // ── List a meeting's action items (Req 9.1) ──────────────────────────────
  app.get("/v1/meetings/:meetingId/action-items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const rows = await repo.getActionItems(ctx.tenantId, meetingId);
    return reply.send({ data: rows });
  });

  // ── My assigned action items (Req 9.x) ───────────────────────────────────
  // Static segment declared before the parametric `:actionId` routes (Fastify prefers static).
  app.get("/v1/meetings/action-items/my", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const rows = await repo.getMyActions(ctx.tenantId, ctx.actorId);
    return reply.send({ data: rows });
  });

  // ── Overdue action items, optionally scoped to a committee (Req 9.5, P21) ─
  app.get("/v1/meetings/action-items/overdue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { committeeId } = overdueQuery.parse(req.query ?? {});
    if (committeeId && !(await repo.committeeExists(ctx.tenantId, committeeId))) {
      throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    }
    const rows = await repo.getOverdue(ctx.tenantId, committeeId);
    return reply.send({ data: rows });
  });

  // ── Generate the committee Action Taken Report (Req 10.1–10.5) ────────────
  app.get("/v1/meetings/committees/:committeeId/atr", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { committeeId } = committeeParam.parse(req.params);
    const { meetings: window } = atrQuery.parse(req.query ?? {});
    if (!(await repo.committeeExists(ctx.tenantId, committeeId))) {
      throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    }
    const report = await repo.getATR(ctx.tenantId, committeeId, window);
    return reply.send({ data: report });
  });

  // ── Progress history for an action item (Req 10.2) ───────────────────────
  app.get("/v1/meetings/action-items/:actionId/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { actionId } = actionParam.parse(req.params);
    await assertActionItemExists(ctx.tenantId, actionId);
    const rows = await repo.getProgressHistory(ctx.tenantId, actionId);
    return reply.send({ data: rows });
  });

  // ── Update an action item (Req 9.1) — optimistic-locked on version ────────
  app.patch("/v1/meetings/action-items/:actionId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, UPDATE_ROLES);
    requireIdempotencyKey(ctx);
    const { actionId } = actionParam.parse(req.params);
    const body = actionItemUpdateSchema.parse(req.body);
    await assertActionItemExists(ctx.tenantId, actionId);
    const accepted = await commands.actionItemUpdate(ctx, actionId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Acknowledge assignment (Req 9.4) ──────────────────────────────────────
  app.post("/v1/meetings/action-items/:actionId/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSIGNEE_ROLES);
    requireIdempotencyKey(ctx);
    const { actionId } = actionParam.parse(req.params);
    const body = actionItemAcknowledgeSchema.parse(req.body);
    await assertActionItemExists(ctx.tenantId, actionId);
    const accepted = await commands.actionItemAcknowledge(ctx, actionId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Submit a progress update (Req 9.x, 10.2) ─────────────────────────────
  app.post("/v1/meetings/action-items/:actionId/progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSIGNEE_ROLES);
    requireIdempotencyKey(ctx);
    const { actionId } = actionParam.parse(req.params);
    const body = actionItemProgressSchema.parse(req.body);
    await assertActionItemExists(ctx.tenantId, actionId);
    const accepted = await commands.actionItemProgress(ctx, actionId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Submit completion evidence (Req 9.7, P22) ─────────────────────────────
  app.post("/v1/meetings/action-items/:actionId/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSIGNEE_ROLES);
    requireIdempotencyKey(ctx);
    const { actionId } = actionParam.parse(req.params);
    const body = actionItemEvidenceSchema.parse(req.body);
    await assertActionItemExists(ctx.tenantId, actionId);
    const accepted = await commands.actionItemEvidence(ctx, actionId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Verify completion (Req 9.7) ───────────────────────────────────────────
  app.post("/v1/meetings/action-items/:actionId/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VERIFY_ROLES);
    requireIdempotencyKey(ctx);
    const { actionId } = actionParam.parse(req.params);
    const body = actionItemVerifySchema.parse(req.body);
    await assertActionItemExists(ctx.tenantId, actionId);
    const accepted = await commands.actionItemVerify(ctx, actionId, body);
    return reply.code(202).send({ data: accepted });
  });
}
