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
import { resolveContext, requireRole } from "../../shared/context.js";
import * as commands from "./commands.js";

// Roles that may trigger identity verification: the visitor themselves
// (via citizen portal), security guards at kiosks, or admins.
const VERIFY_ROLES = ["visitor", "security_guard", "security_admin", "tenant_admin", "super_admin"];

// ── Zod validators ────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid("invalid visit-request id") });

const digilockerBody = z.object({
  identityMethod: z.literal("digilocker"),
  digilockerUri: z.string().min(1, "digilockerUri is required").max(2048, "digilockerUri must be 2048 characters or fewer"),
});

const aadhaarFaceBody = z.object({
  identityMethod: z.literal("aadhaar_face"),
  aadhaarRef: z.string().min(1, "aadhaarRef is required").max(256, "aadhaarRef must be 256 characters or fewer"),
  livePhotoBase64: z.string().min(1, "livePhotoBase64 is required"),
  confidenceThreshold: z.number().min(0).max(100).optional(),
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
    const body = verifyIdentityBody.parse(req.body);

    let accepted: commands.Accepted;

    if (body.identityMethod === "digilocker") {
      accepted = await commands.digilockerVerify(ctx, {
        visitRequestId: id,
        digilockerUri: body.digilockerUri,
      });
    } else {
      // aadhaar_face
      accepted = await commands.aadhaarFaceMatch(ctx, {
        visitRequestId: id,
        aadhaarRef: body.aadhaarRef,
        livePhotoBase64: body.livePhotoBase64,
        ...(body.confidenceThreshold !== undefined ? { confidenceThreshold: body.confidenceThreshold } : {}),
      });
    }

    return reply.code(202).send({ data: accepted });
  });
}
