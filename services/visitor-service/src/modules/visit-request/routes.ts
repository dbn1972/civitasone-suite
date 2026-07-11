/**
 * visitor-service: visit-request HTTP routes.
 *
 * Follows the route → zod validate → publish → 202 CQRS convention
 * (structure.md), matching `modules/blacklist/routes.ts` and
 * `modules/location/routes.ts` exactly in shape.
 *
 * Requirement 1.5: `POST /v1/visitor/visit-requests` runs the blacklist
 * screen (Redis `SISMEMBER` via `screening-store.ts#isBlacklisted`)
 * SYNCHRONOUSLY, before publishing `visitRequestCreate`. A match rejects
 * with 403 `VISITOR_BLACKLISTED` (no reason disclosed to the caller — the
 * blacklist entry's reason/existence is security-sensitive) and does NOT
 * publish anything, so a blocked visitor never even enters the approval
 * queue (Property: a blacklisted identity document never reaches the
 * `pending_approval` state).
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { identityDocHash } from "../blacklist/blind-index.js";
import { isBlacklisted } from "../blacklist/screening-store.js";
import { logConsent } from "../dpdp/consent.js";
import {
  createVisitRequestBody,
  rejectVisitRequestBody,
  listVisitRequestsQuery,
  idParam,
} from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// Visit requests carry visitor PII and are visible to the requesting
// host/visitor as well as security/admin staff (Requirement 1.6, 3.1):
// any authenticated employee/host can create and see requests (the
// consumer/DB layer is the source of truth for "own" scoping on list —
// this route-level gate only excludes fully anonymous/unauthenticated
// callers), while security_admin/tenant_admin/super_admin have full
// visibility across the tenant per the blacklist/location module convention.
const READ_ROLES = ["employee", "security_admin", "protocol_officer", "tenant_admin", "super_admin"];
const WRITE_ROLES = ["employee", "security_admin", "protocol_officer", "tenant_admin", "super_admin"];
const APPROVAL_ROLES = ["employee", "security_admin", "protocol_officer", "tenant_admin", "super_admin"];

export async function visitRequestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/visitor/visit-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createVisitRequestBody.parse(req.body);

    // Requirement 1.5: synchronous blacklist screen BEFORE publish. Only an
    // identity document actually submitted can be screened — no doc ref
    // means nothing to screen against, so it falls through to normal
    // approval routing (screening cannot be bypassed by supplying a doc
    // ref, only by omitting it entirely, same as the DB-level screen).
    if (body.identityDocRef) {
      const hash = identityDocHash(body.identityDocRef, body.identityDocType);
      const blocked = await isBlacklisted(ctx.tenantId, hash);
      if (blocked) {
        // No reason disclosed — do not reveal blacklist details to the caller.
        throw new HttpError(403, "VISITOR_BLACKLISTED", "this visit request cannot be processed");
      }
    }

    // Requirement 18.1: capture explicit consent before any PII write.
    // The visitor implicitly consents by submitting the form; we log which
    // data fields are collected and the stated purposes.
    await logConsent(
      db,
      ctx.tenantId,
      body.visitorPhone, // non-PII visitor reference (phone used as identifier before visit ID exists)
      "visit_management,security,emergency_contact",
      ["name", "phone", "email", "identity_doc"].filter((f) => {
        if (f === "email") return body.visitorEmail !== undefined;
        if (f === "identity_doc") return body.identityDocRef !== undefined;
        return true;
      }),
    );

    // zod's `.nullable().optional()` fields carry an explicit `| undefined`
    // arm (exactOptionalPropertyTypes-incompatible with commands.ts's plain
    // optional fields) — rebuild the object omitting any undefined-valued
    // optional keys, matching the convention used in modules/blacklist/routes.ts.
    const accepted = await commands.visitRequestCreate(ctx, {
      locationId: body.locationId,
      visitorName: body.visitorName,
      visitorPhone: body.visitorPhone,
      purpose: body.purpose,
      hostEmployeeId: body.hostEmployeeId,
      scheduledAt: body.scheduledAt,
      ...(body.visitorEmail !== undefined ? { visitorEmail: body.visitorEmail } : {}),
      ...(body.passType !== undefined ? { passType: body.passType } : {}),
      ...(body.identityDocType !== undefined ? { identityDocType: body.identityDocType } : {}),
      ...(body.identityDocRef !== undefined ? { identityDocRef: body.identityDocRef } : {}),
      ...(body.visitorCategory !== undefined ? { visitorCategory: body.visitorCategory } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.permittedAreas !== undefined ? { permittedAreas: body.permittedAreas } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });

  app.get("/v1/visitor/visit-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listVisitRequestsQuery.parse(req.query);
    const rows = await repo.listVisitRequests(ctx.tenantId, query, { actorId: ctx.actorId, correlationId: ctx.correlationId });
    return reply.send({ data: rows });
  });

  app.get("/v1/visitor/visit-requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.getVisitRequestById(ctx.tenantId, id, { actorId: ctx.actorId, correlationId: ctx.correlationId });
    if (!row) throw new HttpError(404, "NOT_FOUND", "visit request not found");
    return reply.send({ data: row });
  });

  app.post("/v1/visitor/visit-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVAL_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.getVisitRequestById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "visit request not found");
    const accepted = await commands.visitRequestApprove(ctx, { requestId: id });
    return reply.code(202).send({ data: accepted });
  });

  app.post("/v1/visitor/visit-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVAL_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.getVisitRequestById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "visit request not found");
    const body = rejectVisitRequestBody.parse(req.body);
    const accepted = await commands.visitRequestReject(ctx, { requestId: id, reason: body.reason });
    return reply.code(202).send({ data: accepted });
  });

  // DELETE = soft-delete/cancel via command (CivitasOne convention — never
  // hard-delete), not a synchronous hard-delete of the row.
  app.delete("/v1/visitor/visit-requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.getVisitRequestById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "visit request not found");
    const accepted = await commands.visitRequestCancel(ctx, { requestId: id });
    return reply.code(202).send({ data: accepted });
  });
}
