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
import { randomUUID } from "node:crypto";

const HR_ROLES = ["hr_admin", "super_admin", "admin"];
const ALL_ROLES = [...HR_ROLES, "officer", "employee", "manager"];

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

    if (existing[0]) {
      // One-time update allowed — deactivate old, insert new
      await db.update(hrmsProfilePhotos)
        .set({ isActive: false } as any)
        .where(eq(hrmsProfilePhotos.id, existing[0].id));
    }

    const photoId = randomUUID();
    await db.insert(hrmsProfilePhotos).values({
      id: photoId, tenantId: ctx.tenantId, employeeId: id,
      photoKey: body.photoKey, photoBucket: body.photoBucket,
      uploadedAt: new Date(), isActive: true,
    } as any);

    return reply.code(201).send({ id: photoId, status: "uploaded", message: "Profile photo uploaded. Will be used for attendance face verification." });
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
    await db.insert(hrmsFaceVerificationLog).values({
      id: randomUUID(), tenantId: ctx.tenantId, employeeId: body.employeeId,
      geoAttendanceId: body.geoAttendanceId ?? null,
      selfieKey: body.selfieKey, profilePhotoKey: profile.photoKey,
      verificationMethod: result.method, similarityScore: String(result.finalScore),
      confidenceThreshold: String(faceConfig.onnxThreshold),
      isMatch: result.isMatch, rekognitionUsed: result.method === "rekognition",
      onnxScore: result.onnxScore !== null ? String(result.onnxScore) : null,
      rekognitionScore: result.rekognitionScore !== null ? String(result.rekognitionScore) : null,
      processingMs: result.processingMs, failureReason: result.failureReason,
    } as any);

    return reply.send({
      verified: result.isMatch,
      method: result.method,
      score: result.finalScore,
      threshold: result.method === "onnx" ? faceConfig.onnxThreshold : faceConfig.rekognitionThreshold,
      message: result.isMatch ? "Face verified successfully" : result.failureReason ?? "Face verification failed",
      processingMs: result.processingMs,
    });
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

    await db.update(hrmsFaceConfig).set({ ...body, updatedAt: new Date() } as any)
      .where(eq(hrmsFaceConfig.tenantId, ctx.tenantId));
    return reply.send({ status: "updated" });
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
