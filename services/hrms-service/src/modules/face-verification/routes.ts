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
 * SEC (DPDP/PII-sensitive -- biometric data): GET .../attendance/face-log
 * required `employeeId` but never checked it was the caller's own (or a
 * direct report's) -- any authenticated caller under ALL_ROLES (bare
 * "employee" included) could read another employee's face-verification
 * history (match/no-match outcome, similarity score, method, timestamps)
 * simply by naming a different uuid in the query string. Found in passing
 * by a reviewer checking an unrelated PR in this same campaign; reproduced
 * against current source before this fix -- this route had no ownership
 * check at all (not even the "wrong id space" bug the campaign's other
 * self-scoping fixes started from -- there was simply no comparison here).
 *
 * Pure decision function (no DB access), so the authorization rule itself
 * is directly unit-testable without a Fastify/DB harness -- mirrors
 * geo-attendance/routes.ts's resolveGeoHistoryScope (GAP-HR-ATTENDANCE-05,
 * PR #1668), the closest sibling in shape: a mandatory single employeeId
 * query param backing a "this one employee's history" response, on the
 * same attendance surface. Extended one tier further to match attendance/
 * routes.ts's own resolveSelfScopedEmployeeId (GAP-HR-SF-10/SF-16): a
 * manager may also see a direct report's history, not just their own.
 * Reimplemented locally here rather than importing either sibling's
 * (non-exported) helper -- this module has no dependency on attendance/
 * routes.ts or geo-attendance/routes.ts, and per this repo's module-
 * isolation rule the fix uses only the same shared primitives every one of
 * those siblings already builds on (resolveEmployeeForActor,
 * hrmsEmployees.managerId), not a cross-module reach-in.
 *
 * Rules:
 *  - requestedEmployeeId is the caller's own resolved id -> allowed, any role.
 *  - requestedEmployeeId is one of the caller's direct reports (managerId FK)
 *    AND the caller holds "manager" -> allowed.
 *  - caller holds one of this module's HR_ROLES -> allowed, any target
 *    (unchanged, tenant-wide access preserved).
 *  - caller has no linked employee record at all -> 403 NO_EMPLOYEE_RECORD
 *    (can't be proven "self", can't be proven "manager of").
 *  - otherwise (a real link, but the target is neither self, a report, nor
 *    the caller privileged) -> 403 FORBIDDEN. Fails closed on every path
 *    that isn't an explicit allow above -- never silently substitutes the
 *    caller's own id and never falls through to unfiltered.
 */
export function resolveFaceLogScope(
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
  throw new HttpError(403, "FORBIDDEN", "you may only view your own or your direct reports' face-verification history");
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

    // Upsert profile photo
    const existing = await scopedRead((tx) => tx.select().from(hrmsProfilePhotos)
      .where(and(eq(hrmsProfilePhotos.tenantId, ctx.tenantId), eq(hrmsProfilePhotos.employeeId, id))).limit(1));

    const photoId = randomUUID();
    await publishF3Write(ctx, "face_verification_routes__0", photoId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(201).send({ id: photoId, status: "uploaded", message: "Profile photo uploaded. Will be used for attendance face verification." }) as any;
  });

  // ── Get employee's profile photo info ──
  app.get("/v1/hrms/employees/:id/profile-photo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await scopedRead((tx) => tx.select().from(hrmsProfilePhotos)
      .where(and(eq(hrmsProfilePhotos.tenantId, ctx.tenantId), eq(hrmsProfilePhotos.employeeId, id), eq(hrmsProfilePhotos.isActive, true))).limit(1));

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

    // Load profile photo
    const profileRows = await scopedRead((tx) => tx.select().from(hrmsProfilePhotos)
      .where(and(eq(hrmsProfilePhotos.tenantId, ctx.tenantId), eq(hrmsProfilePhotos.employeeId, body.employeeId), eq(hrmsProfilePhotos.isActive, true))).limit(1));

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
  //
  // SEC fix (see resolveFaceLogScope above): employeeId is resolved through
  // the same self/manager-of-reports/HR scoping every sibling attendance-
  // adjacent read route in this service already enforces, instead of being
  // trusted unchecked from the query string.
  app.get("/v1/hrms/attendance/face-log", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);

    const self = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    const directReportIds = self && ctx.roles.includes("manager")
      ? (await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
          .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.managerId, self.id)))))
          .map((r) => r.id)
      : [];
    const empId = resolveFaceLogScope(ctx.roles, self?.id ?? null, directReportIds, q.employeeId);

    const rows = await scopedRead((tx) => tx.select().from(hrmsFaceVerificationLog)
      .where(and(eq(hrmsFaceVerificationLog.tenantId, ctx.tenantId), eq(hrmsFaceVerificationLog.employeeId, empId))));
    return reply.send({ data: rows.slice(0, 50).map(r => ({ id: r.id, method: r.verificationMethod, score: r.similarityScore, isMatch: r.isMatch, verifiedAt: r.verifiedAt, processingMs: r.processingMs })) });
  });
}
