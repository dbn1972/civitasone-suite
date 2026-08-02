/**
 * visitor-service: DPDP compliance routes.
 *
 * Requirement 18.4 — Right to Erasure:
 *   POST /v1/visitor/dpdp/erasure-requests
 *   Accepts a visitor reference (visitorRef) or phone number (visitorPhone),
 *   publishes a `dpdpErasureRequest` command that marks all matching
 *   visit_requests with `erasure_requested_at = now()` and sends a
 *   NOTIFICATION_SEND confirmation to the visitor, and returns 202
 *   Accepted. Actual PII deletion happens within 72h via a scheduled purge
 *   worker (task 20.2).
 *
 * Task Q-95.2: the erasure-marking UPDATE itself moved off the synchronous
 * route handler and onto the queue -> consumer CQRS convention (see
 * ./commands.ts for why this is safe against the 72h SLA). `recordsMarked`
 * in the response is a best-effort, read-only preview count computed here
 * (RLS-scoped, no write) so the caller still gets immediate feedback; the
 * consumer is the source of truth for the actual mutation.
 *
 * Access: dpo (data protection officer), tenant_admin, super_admin.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and, or, isNull, type SQL } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { visitRequests } from "../visit-request/schema.js";
import * as commands from "./commands.js";

const ERASURE_ROLES = ["dpo", "tenant_admin", "super_admin"];

/**
 * Zod schema for erasure request body.
 * At least one of visitorRef or visitorPhone must be provided.
 */
const erasureRequestBody = z.object({
  visitorRef: z.string().min(1).optional(),
  visitorPhone: z.string().min(1).optional(),
}).refine(
  (data) => Boolean(data.visitorRef) || Boolean(data.visitorPhone),
  { message: "At least one of visitorRef or visitorPhone must be provided" },
);

export async function dpdpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/visitor/dpdp/erasure-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ERASURE_ROLES);

    const body = erasureRequestBody.parse(req.body);
    const erasureId = randomUUID();

    // Build the WHERE condition to find matching visit requests for this tenant.
    // Match by tracking_ref (visitorRef) or visitor_phone (visitorPhone).
    // Only count rows that have NOT already been marked for erasure — mirrors
    // the consumer's eligibility guard exactly.
    const conditions: SQL[] = [];
    if (body.visitorRef) conditions.push(eq(visitRequests.trackingRef, body.visitorRef));
    if (body.visitorPhone) conditions.push(eq(visitRequests.visitorPhone, body.visitorPhone));
    const matchCondition = conditions.length === 1 ? conditions[0]! : or(...conditions)!;

    // Read-only preview count (RLS-scoped) — no write happens here.
    const previewRows = await scopedRead((tx) => tx
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.tenantId, ctx.tenantId),
          matchCondition,
          isNull(visitRequests.erasureRequestedAt),
        ),
      ));
    const recordsMarked = previewRows.length;

    await commands.dpdpErasureRequest(ctx, {
      erasureId,
      ...(body.visitorRef !== undefined ? { visitorRef: body.visitorRef } : {}),
      ...(body.visitorPhone !== undefined ? { visitorPhone: body.visitorPhone } : {}),
    });

    return reply.code(202).send({
      data: {
        erasureId,
        status: "accepted",
        recordsMarked,
        message: "Erasure request accepted. PII will be removed within 72 hours.",
      },
    });
  });
}
