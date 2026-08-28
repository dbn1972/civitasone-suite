/**
 * visitor-service: identity verification routes.
 *
 * POST /v1/visitor/visit-requests/:id/verify-identity
 *
 * The route validates the request body (discriminated union on `identityMethod`),
 * delegates to the appropriate command publisher (`digilockerVerify` or
 * `aadhaarFaceMatch`), and returns 202 Accepted per the CQRS pattern.
 *
 * Requirements 7.1, 8.1.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import { getVisitRequestById } from "../visit-request/repo.js";

// Roles that may trigger identity verification: the visitor themselves
// (via citizen portal), security guards at kiosks, or admins.
const VERIFY_ROLES = ["visitor", "security_guard", "security_admin", "tenant_admin", "super_admin"];

// Fix 1 (CRITICAL — cross-actor IDOR, CWE-639): every VERIFY_ROLES entry
// EXCEPT "visitor" is a staff/elevated role authorized to act on ANY visit
// request in the tenant (matching how a security guard or admin operates a
// kiosk on behalf of whoever is physically present, not a request they
// personally "own"). The "visitor" role, by contrast, is explicitly scoped
// (see the comment above) to the visitor verifying THEIR OWN visit request
// — so it is the only VERIFY_ROLES entry that requires an ownership check
// against the target visit request before being allowed to proceed.
const ELEVATED_VERIFY_ROLES = ["security_guard", "security_admin", "tenant_admin", "super_admin"];

// ── Zod validators ────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid("invalid visit-request id") });

const digilockerBody = z.object({
  identityMethod: z.literal("digilocker"),
  digilockerUri: z.string().min(1, "digilockerUri is required").max(2048, "digilockerUri must be 2048 characters or fewer"),
});

// Fix 2: `confidenceThreshold` is intentionally NOT part of this schema.
// It previously accepted a caller-supplied value bounded only to [0, 100]
// (no floor), which let any caller — including the lowest-privilege
// "visitor" role — force a face-match "pass" by submitting 0, since
// matchFace() matches whenever confidence >= confidenceThreshold and
// confidence is never negative. The threshold is now always resolved
// server-side (identity/aadhaar-face-adapter.ts#DEFAULT_CONFIDENCE_THRESHOLD,
// applied in identity/consumer.ts) and is never client-influenceable.
const aadhaarFaceBody = z.object({
  identityMethod: z.literal("aadhaar_face"),
  aadhaarRef: z.string().min(1, "aadhaarRef is required").max(256, "aadhaarRef must be 256 characters or fewer"),
  livePhotoBase64: z.string().min(1, "livePhotoBase64 is required"),
});

const verifyIdentityBody = z.discriminatedUnion("identityMethod", [
  digilockerBody,
  aadhaarFaceBody,
]);

export type VerifyIdentityBody = z.infer<typeof verifyIdentityBody>;

// ── Route registration ────────────────────────────────────────────

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/visitor/visit-requests/:id/verify-identity", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VERIFY_ROLES);

    const { id } = idParam.parse(req.params);

    // Fix 1: ownership check. Elevated/staff roles may verify identity on
    // any visit request in their tenant; a "visitor"-role caller must be
    // the request's own visitor, host, or original creator — mirroring the
    // ownership predicate used for approve/reject/cancel elsewhere in this
    // service (visit-request module). A visit request that does not exist
    // (or belongs to another tenant, per getVisitRequestById's tenant scope)
    // 404s before any ownership decision is made, so existence is never
    // leaked to a caller who wouldn't otherwise be authorized to act on it.
    const visitRequest = await getVisitRequestById(ctx.tenantId, id, {
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
    });
    if (!visitRequest) {
      throw new HttpError(404, "NOT_FOUND", "visit request not found");
    }
    if (!hasAnyRole(ctx, ELEVATED_VERIFY_ROLES)) {
      const isOwner =
        ctx.actorId === visitRequest.visitorId ||
        ctx.actorId === visitRequest.hostEmployeeId ||
        ctx.actorId === visitRequest.createdBy;
      if (!isOwner) {
        throw new HttpError(403, "FORBIDDEN", "not authorized to verify identity for this visit request");
      }
    }

    const body = verifyIdentityBody.parse(req.body);

    let accepted: commands.Accepted;

    if (body.identityMethod === "digilocker") {
      accepted = await commands.digilockerVerify(ctx, {
        visitRequestId: id,
        digilockerUri: body.digilockerUri,
      });
    } else {
      // aadhaar_face — confidenceThreshold is never taken from the client
      // (Fix 2); commands.aadhaarFaceMatch/consumer.ts resolve it server-side.
      accepted = await commands.aadhaarFaceMatch(ctx, {
        visitRequestId: id,
        aadhaarRef: body.aadhaarRef,
        livePhotoBase64: body.livePhotoBase64,
      });
    }

    return reply.code(202).send({ data: accepted });
  });
}
