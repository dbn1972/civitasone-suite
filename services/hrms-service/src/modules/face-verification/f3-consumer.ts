import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsProfilePhotos, hrmsFaceVerificationLog, hrmsFaceConfig } from "./schema.js";
const log = pino({ name: "hrms-f3-face-verification" });
export function registerF3_face_verification_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "face_verification_routes__0",
      "face_verification_routes__1",
      "face_verification_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "face_verification_routes__0": {
            if (existing[0]) {
                    // One-time update allowed — deactivate old, insert new
                    await tx.update(hrmsProfilePhotos)
                      .set({ isActive: false } as any)
                      .where(eq(hrmsProfilePhotos.id, existing[0].id));
                  }

                  await tx.insert(hrmsProfilePhotos).values({
                    id: photoId, tenantId: p.tenantId, employeeId: id,
                    photoKey: body.photoKey, photoBucket: body.photoBucket,
                    uploadedAt: new Date(), isActive: true,
                  } as any);
            break;
          }
          case "face_verification_routes__1": {
            await tx.insert(hrmsFaceVerificationLog).values({
                  id: randomUUID(), tenantId: p.tenantId, employeeId: body.employeeId,
                  geoAttendanceId: body.geoAttendanceId ?? null,
                  selfieKey: body.selfieKey, profilePhotoKey: profile.photoKey,
                  verificationMethod: result.method, similarityScore: String(result.finalScore),
                  confidenceThreshold: String(faceConfig.onnxThreshold),
                  isMatch: result.isMatch, rekognitionUsed: result.method === "rekognition",
                  onnxScore: result.onnxScore !== null ? String(result.onnxScore) : null,
                  rekognitionScore: result.rekognitionScore !== null ? String(result.rekognitionScore) : null,
                  processingMs: result.processingMs, failureReason: result.failureReason,
                } as any);
            break;
          }
          case "face_verification_routes__2": {
            await tx.update(hrmsFaceConfig).set({ ...body, updatedAt: new Date() } as any)
                  .where(eq(hrmsFaceConfig.tenantId, p.tenantId));
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
