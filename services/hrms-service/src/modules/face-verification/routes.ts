import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Face Verification Routes
 * - Upload profile photo (one-time during onboarding)
 * - Verify attendance selfie against profile
 * - Admin: configure face match settings
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import { verifyFace, type FaceConfig } from "./engine.js";
import { hrmsProfilePhotos, hrmsFaceVerificationLog, hrmsFaceConfig } from "./schema.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import { hrmsEmployees } from "../employee/schema.js";

const HR_ROLES = ["hr_admin", "super_admin", "admin"];
const ALL_ROLES = [...HR_ROLES, "officer", "employee", "manager"];

/**
 * SEC (DPDP/PII-sensitive -- profile photo underlies face-verification):
 * flagged as an out-of-scope sibling finding in PR #1682 (the face-log IDOR
 * fix for GET .../attendance/face-log below, in this same file -- see that
 * PR's description). PR #1682 is not yet merged as of this change (built on
 * plain `main`, not stacked on it), so its `resolveFaceLogScope` does not
 * exist in this file yet -- this function instead mirrors the shape that PR
 * establishes (self / manager's-direct-report / HR-any-target / fail
 * closed), adapted to this route's own access model, below.
 *
 * This route accepted `:id` from the URL under ALL_ROLES with no check it
 * was the caller's own id, so any authenticated employee could upload
 * (overwrite) ANOTHER employee's registered profile photo. Beyond a plain
 * IDOR, this is an attendance-fraud vector: whoever controls an employee's
 * profile photo controls what the ONNX/Rekognition pipeline treats as that
 * employee's face -- an attacker who could set a colleague's photoKey to
 * their OWN photo would make every future face-verification "prove" the
 * attacker is that colleague.
 *
 * Scope, per this route's own doc comment ("one-time by employee or HR
 * during onboarding"): self (any role) or HR_ROLES may upload for the named
 * employee. There is no "manager uploads a report's photo" workflow
 * documented, or referenced anywhere else in this service, so -- unlike the
 * read-oriented 3-tier shape below -- plain "manager" gets no on-behalf-of
 * allowance here. Reimplemented locally (this repo's module-isolation
 * rule); builds only on the same resolveEmployeeForActor primitive every
 * sibling scoping helper in this service already uses.
 */
export function resolveProfilePhotoWriteScope(
  roles: string[],
  selfEmployeeId: string | null,
  requestedEmployeeId: string,
): string {
  if (HR_ROLES.some((r) => roles.includes(r))) return requestedEmployeeId;
  if (selfEmployeeId && requestedEmployeeId === selfEmployeeId) return requestedEmployeeId;
  if (!selfEmployeeId) {
    throw new HttpError(403, "NO_EMPLOYEE_RECORD", "no employee record is linked to this account");
  }
  throw new HttpError(403, "FORBIDDEN", "you may only upload your own profile photo");
}

/**
 * SEC (DPDP/PII-sensitive): same out-of-scope finding flagged in PR #1682
 * (see resolveProfilePhotoWriteScope's doc comment above for why that PR's
 * own `resolveFaceLogScope` isn't a symbol in this file yet) -- this route
 * accepted `:id` from the URL under ALL_ROLES with no ownership check, so
 * any authenticated employee could read another employee's profile-photo
 * metadata (storage key, upload/verification timestamps). Mirrors the
 * self / a-manager's-own-direct-report / HR-any-target / fail-closed-
 * otherwise shape PR #1682 establishes for face-log below, since this is a
 * read of the same kind of identity-linked biometric-adjacent record on the
 * same module -- not the upload workflow's narrower self-or-HR-only shape
 * above.
 */
export function resolveProfilePhotoReadScope(
  roles: string[],
  selfEmployeeId: string | null,
  directReportIds: string[],
  requestedEmployeeId: string,
): string {
  if (HR_ROLES.some((r) => roles.includes(r))) return requestedEmployeeId;
  if (selfEmployeeId && requestedEmployeeId === selfEmployeeId) return requestedEmployeeId;
  if (roles.includes("manager") && directReportIds.includes(requestedEmployeeId)) return requestedEmployeeId;
  if (!selfEmployeeId) {
    throw new HttpError(403, "NO_EMPLOYEE_RECORD", "no employee record is linked to this account");
  }
  throw new HttpError(403, "FORBIDDEN", "you may only view your own or your direct reports' profile photo");
}

/**
 * SEC (DPDP/PII-sensitive -- live biometric check): sibling finding flagged
 * out-of-scope in PR #1682 -- this route took `employeeId` from the request
 * BODY under ALL_ROLES with no check it was the caller's own id. Beyond
 * reading someone else's match outcome, POSTing here actually RUNS the
 * match pipeline against a target employee's stored profile photo using a
 * selfie the caller supplies, and (via the queued
 * face_verification_routes__1 write) creates a face-verification-log row
 * attributed to that target -- an attacker could fabricate verified/failed
 * biometric attendance records for a colleague, or probe whether an
 * arbitrary photo matches a specific employee's registered face.
 *
 * Unlike the read routes above, there is no HR-or-manager on-behalf-of
 * workflow to preserve: per this route's own doc comment ("Verify face
 * during attendance (called by geo-check-in)") this is a live "prove it's
 * you right now" check tied to the caller's own attendance -- the same
 * category as geo-attendance/routes.ts's resolveSelfEmployeeOrThrow (that
 * module's own geo-check-in/out IDOR fix): "verify on behalf of someone
 * else" has no coherent meaning here, for HR/admin either. Self-only for
 * EVERY role, fails closed with no exceptions. Reimplemented locally
 * (module-isolation rule) rather than importing geo-attendance's helper.
 */
export function resolveVerifyFaceScope(
  selfEmployeeId: string | null,
  requestedEmployeeId: string,
): string {
  if (selfEmployeeId && requestedEmployeeId === selfEmployeeId) return requestedEmployeeId;
  if (!selfEmployeeId) {
    throw new HttpError(403, "NO_EMPLOYEE_RECORD", "no employee record is linked to this account");
  }
  throw new HttpError(403, "FORBIDDEN", "you may only verify your own face for attendance");
}

export async function faceVerificationRoutes(app: FastifyInstance): Promise<void> {
  // ── Upload profile photo (one-time by employee or HR during onboarding) ──
  app.post("/v1/hrms/employees/:id/profile-photo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      photoKey: z.string().min(1).max(1024),
      photoBucket: z.string().default("civitasone-photos"),
    }).parse(req.body);

    // SEC fix (see resolveProfilePhotoWriteScope above): `id` is authorized
    // against the caller's own resolved employee id (or HR_ROLES) before any
    // read/write against it, instead of being trusted unchecked from the URL.
    const self = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    const employeeId = resolveProfilePhotoWriteScope(ctx.roles, self?.id ?? null, id);

    // Upsert profile photo
    const existing = await scopedRead((tx) => tx.select().from(hrmsProfilePhotos)
      .where(and(eq(hrmsProfilePhotos.tenantId, ctx.tenantId), eq(hrmsProfilePhotos.employeeId, employeeId))).limit(1));

    const photoId = randomUUID();
    await publishF3Write(ctx, "face_verification_routes__0", photoId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(201).send({ id: photoId, status: "uploaded", message: "Profile photo uploaded. Will be used for attendance face verification." }) as any;
  });

  // ── Get employee's profile photo info ──
  app.get("/v1/hrms/employees/:id/profile-photo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // SEC fix (see resolveProfilePhotoReadScope above): `id` is resolved
    // through the same self/manager-of-reports/HR scoping PR #1682
    // establishes for the face-log route below (not yet merged as of this
    // change), instead of being trusted unchecked from the URL.
    const self = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    const directReportIds = self && ctx.roles.includes("manager")
      ? (await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
          .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.managerId, self.id)))))
          .map((r) => r.id)
      : [];
    const employeeId = resolveProfilePhotoReadScope(ctx.roles, self?.id ?? null, directReportIds, id);

    const rows = await scopedRead((tx) => tx.select().from(hrmsProfilePhotos)
      .where(and(eq(hrmsProfilePhotos.tenantId, ctx.tenantId), eq(hrmsProfilePhotos.employeeId, employeeId), eq(hrmsProfilePhotos.isActive, true))).limit(1));

    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "No profile photo uploaded for this employee");
    return reply.send({ id: rows[0].id, photoKey: rows[0].photoKey, uploadedAt: rows[0].uploadedAt, verified: !!rows[0].verifiedAt });
  });

  // ── Verify face during attendance (called by geo-check-in) ──
  app.post("/v1/hrms/attendance/verify-face", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      selfieKey: z.string().min(1),
      geoAttendanceId: z.string().uuid().optional(),
    }).parse(req.body);

    // SEC fix (see resolveVerifyFaceScope above): body.employeeId is checked
    // against the caller's own resolved employee id before it is used for
    // anything -- self-only, no manager/HR on-behalf-of allowance (see that
    // function's doc comment for why).
    const self = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    const employeeId = resolveVerifyFaceScope(self?.id ?? null, body.employeeId);

    // Load profile photo
    const profileRows = await scopedRead((tx) => tx.select().from(hrmsProfilePhotos)
      .where(and(eq(hrmsProfilePhotos.tenantId, ctx.tenantId), eq(hrmsProfilePhotos.employeeId, employeeId), eq(hrmsProfilePhotos.isActive, true))).limit(1));

    if (!profileRows[0]) {
      throw new HttpError(400, "NO_PROFILE_PHOTO", "Employee must upload a profile photo before face verification can be used");
    }

    const profile = profileRows[0];

    // Load face config
    const configRows = await scopedRead((tx) => tx.select().from(hrmsFaceConfig)
      .where(eq(hrmsFaceConfig.tenantId, ctx.tenantId)).limit(1));
    const cfg = configRows[0];
    const faceConfig: FaceConfig = {
      onnxEnabled: cfg?.onnxEnabled ?? true,
      onnxThreshold: Number(cfg?.onnxThreshold ?? 0.75),
      rekognitionEnabled: cfg?.rekognitionEnabled ?? true,
      rekognitionThreshold: Number(cfg?.rekognitionThreshold ?? 0.70),
      requireFaceMatch: cfg?.requireFaceMatch ?? true,
      allowManualOverride: cfg?.allowManualOverride ?? true,
    };

    // Run verification pipeline
    const result = await verifyFace(
      body.selfieKey, profile.photoKey,
      profile.faceEmbedding ? Array.from(new Float32Array(profile.faceEmbedding)) : null,
      faceConfig, profile.photoBucket
    );

    // Log verification attempt
    await publishF3Write(ctx, "face_verification_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({
      verified: result.isMatch,
      method: result.method,
      score: result.finalScore,
      threshold: result.method === "onnx" ? faceConfig.onnxThreshold : faceConfig.rekognitionThreshold,
      message: result.isMatch ? "Face verified successfully" : result.failureReason ?? "Face verification failed",
      processingMs: result.processingMs,
    }) as any;
  });

  // ── Admin: Configure face verification settings ──
  app.get("/v1/hrms/admin/face-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsFaceConfig).where(eq(hrmsFaceConfig.tenantId, ctx.tenantId)).limit(1));
    if (!rows[0]) return reply.send({ configured: false });
    return reply.send(rows[0]);
  });

  app.patch("/v1/hrms/admin/face-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      onnxEnabled: z.boolean().optional(),
      onnxThreshold: z.number().min(0.5).max(1.0).optional(),
      rekognitionEnabled: z.boolean().optional(),
      rekognitionThreshold: z.number().min(0.5).max(1.0).optional(),
      requireFaceMatch: z.boolean().optional(),
      allowManualOverride: z.boolean().optional(),
    }).parse(req.body);

    await publishF3Write(ctx, "face_verification_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ status: "updated" }) as any;
  });

  // ── Verification history for an employee ──
  app.get("/v1/hrms/attendance/face-log", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    const rows = await scopedRead((tx) => tx.select().from(hrmsFaceVerificationLog)
      .where(and(eq(hrmsFaceVerificationLog.tenantId, ctx.tenantId), eq(hrmsFaceVerificationLog.employeeId, q.employeeId))));
    return reply.send({ data: rows.slice(0, 50).map(r => ({ id: r.id, method: r.verificationMethod, score: r.similarityScore, isMatch: r.isMatch, verifiedAt: r.verifiedAt, processingMs: r.processingMs })) });
  });
}
