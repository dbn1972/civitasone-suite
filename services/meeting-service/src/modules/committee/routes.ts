/**
 * committee module — HTTP routes (11 endpoints, Req 2.1–2.7).
 *
 * Follows the suite CQRS + envelope conventions (structure.md, steering) and mirrors
 * the sibling-service route shape (visitor-service `visit-request`, citizen-service):
 *   • WRITES  — `resolveContext` → `requireRole` → zod validate → command publish → 202
 *               with `{ data: Accepted }`. Routes NEVER write to Postgres directly; the
 *               consumer applies the change and emits the outbox event.
 *   • READS   — cache-first `repo.*` lookups. Single entity → `{ data }`; lists →
 *               `{ data, meta: { page, pageSize, total } }`. A missing entity 404s
 *               BEFORE any write is published.
 *
 * Error paths: zod parse failures surface as 400 and `HttpError` as its mapped status
 * via the app-level `registerSchemaErrorHandler` (app.ts) — no per-route handler here.
 * `resolveContext` yields 401 for unauthenticated callers; `requireRole` yields 403;
 * unknown/other-tenant ids yield 404. Optimistic-lock conflicts on writes surface as
 * 409 from the consumer's `versionedUpdate` (VERSION_CONFLICT).
 *
 * RBAC (design.md § Access Control Matrix):
 *   • Committee constitute/update — `meeting_admin` (+ tenant/super admin): Full CRUD.
 *   • Membership add/update/remove — `meeting_admin` + `committee_secretary`.
 *   • All reads — admin/secretary/chairperson/member/observer within the tenant.
 *
 * The `version` for optimistic-locked PATCH/DELETE may be supplied by the client (an
 * `If-Match`-style body field); when omitted it defaults to the currently-persisted
 * version read alongside the existence (404) check.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createCommitteeBody,
  updateCommitteeBody,
  addMemberBody,
  updateMemberBody,
  committeeQueryParams,
  committeeIdParam,
  memberIdParam,
} from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

/** Full-CRUD governance roles (committee constitution + amendment). */
const COMMITTEE_ADMIN_ROLES = ["meeting_admin", "tenant_admin", "super_admin", "admin"];
/** Roles allowed to manage the membership roster (admins + secretariat). */
const MEMBER_WRITE_ROLES = ["meeting_admin", "committee_secretary", "tenant_admin", "super_admin", "admin"];
/** Read access to committee governance data. */
const COMMITTEE_READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "tenant_admin",
  "super_admin",
  "admin",
];

/** Optional optimistic-lock version + reason accepted on write bodies. */
const versionBody = z.object({
  version: z.coerce.number().int().nonnegative().optional(),
  reason: z.string().max(1024).optional(),
});

/** Build the standard list envelope meta from offset/limit pagination. */
function listMeta(offset: number, limit: number, total: number) {
  return { page: Math.floor(offset / limit) + 1, pageSize: limit, total };
}

export async function committeeRoutes(app: FastifyInstance): Promise<void> {
  // ─── Committees ──────────────────────────────────────────────────────────

  /** POST /v1/meetings/committees — constitute a committee (Req 2.1, 2.3). */
  app.post("/v1/meetings/committees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMMITTEE_ADMIN_ROLES);
    const body = createCommitteeBody.parse(req.body);
    const accepted = await commands.committeeCreate(ctx, body);
    return reply.code(202).send({ data: accepted });
  });

  /** GET /v1/meetings/committees — list committees (filter by type/status). */
  app.get("/v1/meetings/committees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMMITTEE_READ_ROLES);
    const q = committeeQueryParams.parse(req.query);
    const { rows, total } = await repo.listCommittees(ctx.tenantId, {
      type: q.type,
      status: q.status,
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({ data: rows, meta: listMeta(q.offset, q.limit, total) });
  });

  /** GET /v1/meetings/committees/:committeeId — committee details. */
  app.get("/v1/meetings/committees/:committeeId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMMITTEE_READ_ROLES);
    const { committeeId } = committeeIdParam.parse(req.params);
    const committee = await repo.getCommitteeById(ctx.tenantId, committeeId);
    if (!committee) throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    return reply.send({ data: committee });
  });

  /** PATCH /v1/meetings/committees/:committeeId — amend committee (Req 2.3, 2.7). */
  app.patch("/v1/meetings/committees/:committeeId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMMITTEE_ADMIN_ROLES);
    const { committeeId } = committeeIdParam.parse(req.params);
    const committee = await repo.getCommitteeById(ctx.tenantId, committeeId);
    if (!committee) throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    const patch = updateCommitteeBody.parse(req.body);
    const { version } = versionBody.parse(req.body ?? {});
    const accepted = await commands.committeeUpdate(ctx, committeeId, version ?? committee.version, patch);
    return reply.code(202).send({ data: accepted });
  });

  // ─── Membership roster ─────────────────────────────────────────────────────

  /** POST /v1/meetings/committees/:committeeId/members — add a member (Req 2.2). */
  app.post("/v1/meetings/committees/:committeeId/members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MEMBER_WRITE_ROLES);
    const { committeeId } = committeeIdParam.parse(req.params);
    const committee = await repo.getCommitteeById(ctx.tenantId, committeeId);
    if (!committee) throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    const body = addMemberBody.parse(req.body);
    const accepted = await commands.committeeMemberAdd(ctx, committeeId, body);
    return reply.code(202).send({ data: accepted });
  });

  /** GET /v1/meetings/committees/:committeeId/members — list the roster. */
  app.get("/v1/meetings/committees/:committeeId/members", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMMITTEE_READ_ROLES);
    const { committeeId } = committeeIdParam.parse(req.params);
    const committee = await repo.getCommitteeById(ctx.tenantId, committeeId);
    if (!committee) throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    const members = await repo.getMembers(ctx.tenantId, committeeId);
    return reply.send({ data: members });
  });

  /** PATCH /v1/meetings/committees/:committeeId/members/:memberId — amend a membership. */
  app.patch("/v1/meetings/committees/:committeeId/members/:memberId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MEMBER_WRITE_ROLES);
    const { committeeId, memberId } = memberIdParam.parse(req.params);
    const member = await repo.getMemberById(ctx.tenantId, committeeId, memberId);
    if (!member) throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee membership not found");
    const patch = updateMemberBody.parse(req.body);
    const { version } = versionBody.parse(req.body ?? {});
    const accepted = await commands.committeeMemberUpdate(
      ctx,
      committeeId,
      memberId,
      version ?? member.version,
      patch,
    );
    return reply.code(202).send({ data: accepted });
  });

  /** DELETE /v1/meetings/committees/:committeeId/members/:memberId — soft-remove a member. */
  app.delete("/v1/meetings/committees/:committeeId/members/:memberId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MEMBER_WRITE_ROLES);
    const { committeeId, memberId } = memberIdParam.parse(req.params);
    const member = await repo.getMemberById(ctx.tenantId, committeeId, memberId);
    if (!member) throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee membership not found");
    const { version, reason } = versionBody.parse(req.body ?? {});
    const accepted = await commands.committeeMemberRemove(
      ctx,
      committeeId,
      memberId,
      version ?? member.version,
      reason,
    );
    return reply.code(202).send({ data: accepted });
  });

  // ─── Governance dashboards / reports (reads) ────────────────────────────────

  /** GET /v1/meetings/committees/:committeeId/health — committee health dashboard. */
  app.get("/v1/meetings/committees/:committeeId/health", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMMITTEE_READ_ROLES);
    const { committeeId } = committeeIdParam.parse(req.params);
    const health = await repo.getHealth(ctx.tenantId, committeeId);
    if (!health) throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    return reply.send({ data: health });
  });

  /** GET /v1/meetings/committees/:committeeId/compliance — statutory frequency report (Req 2.5). */
  app.get("/v1/meetings/committees/:committeeId/compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMMITTEE_READ_ROLES);
    const { committeeId } = committeeIdParam.parse(req.params);
    const report = await repo.getComplianceReport(ctx.tenantId, committeeId);
    if (!report) throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    return reply.send({ data: report });
  });

  /** GET /v1/meetings/committees/:committeeId/terms-history — TOR revision history (Req 2.7). */
  app.get("/v1/meetings/committees/:committeeId/terms-history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, COMMITTEE_READ_ROLES);
    const { committeeId } = committeeIdParam.parse(req.params);
    const committee = await repo.getCommitteeById(ctx.tenantId, committeeId);
    if (!committee) throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    const history = await repo.getTermsHistory(ctx.tenantId, committeeId);
    return reply.send({ data: history });
  });
}
