// @ts-nocheck — RETAINED ONLY for case `face_verification_routes__1`, which
// cannot be reconstructed from the queued payload (see the TODO(unresolved-f3-bug)
// on that case). `face_verification_routes__0` and `__2` below are fully repaired
// and type-correct; drop this banner as soon as __1 is fixed at the route.
import { randomUUID } from "node:crypto";
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
    // Every route calls `publishF3Write(ctx, op, randomUUID(), …)`, so `p.id`
    // (and therefore `id` above) is a FRESH uuid minted at publish time — it is
    // NEVER the `:id` from the URL. `id` is only safe as the primary key of a
    // brand-new row; the employee this message is about is the path param.
    const employeeId = String(params.id ?? "");
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "face_verification_routes__0": {
            // F3 codegen repair (same bug class as leave/f3-consumer.ts
            // `leave_policy_admin_routes__0`): the generator dropped the route's
            // "look up the employee's existing profile photo" read and its
            // `const photoId = randomUUID()`, so `existing` and `photoId` were
            // referenced but never defined. Uploading a profile photo threw a
            // ReferenceError here on every call — after the route had already
            // answered 201 "uploaded". No photo row was ever written, so
            // attendance face verification could never be used for anyone.
            //
            // The read is done on `tx` (not the route's scopedRead) so the
            // deactivate-old / insert-new pair is atomic against a concurrent
            // upload: two racing uploads cannot both see "no active photo".
            const existing = await tx.select().from(hrmsProfilePhotos)
              .where(and(eq(hrmsProfilePhotos.tenantId, p.tenantId), eq(hrmsProfilePhotos.employeeId, employeeId)))
              .limit(1);
            // NOTE: the route minted its own `photoId` and returned it as the
            // 201 body's `id`, but never forwarded it in the payload — so that
            // id is unrecoverable here and the row gets the message-scoped id
            // instead. Using `id` (rather than a fresh randomUUID) at least
            // keeps this insert idempotent across redeliveries.
            const photoId = id;
            if (existing[0]) {
                    // One-time update allowed — deactivate old, insert new
                    await tx.update(hrmsProfilePhotos)
                      .set({ isActive: false } as any)
                      .where(eq(hrmsProfilePhotos.id, existing[0].id));
                  }

                  await tx.insert(hrmsProfilePhotos).values({
                    id: photoId, tenantId: p.tenantId, employeeId,
                    photoKey: body.photoKey, photoBucket: body.photoBucket ?? "civitasone-photos",
                    uploadedAt: new Date(), isActive: true,
                  } as any);
            break;
          }
          case "face_verification_routes__1": {
            // TODO(unresolved-f3-bug): STILL BROKEN — throws a ReferenceError on
            // every invocation (`profile`, `faceConfig`, `result` are never
            // defined) while the route already answered 200 with a verdict. The
            // face-verification audit log is therefore EMPTY: every attendance
            // selfie check is enforced but none is recorded.
            //
            // `profile` and `faceConfig` are recoverable (re-read
            // hrms_profile_photos / hrms_face_config for the tenant), but
            // `result` is NOT safely reproducible here. It comes from
            // `verifyFace(...)` in ./engine.ts, which is NOT a pure function:
            //   - it issues a live AWS Rekognition CompareFaces call
            //     (see compareWithRekognition), so re-running it bills a second
            //     inference for every verification, and
            //   - its output is time- and service-dependent (processingMs, and a
            //     Rekognition similarity that can differ between calls, including
            //     a `catch` path that returns score 0 when the API is briefly
            //     unavailable).
            // Re-running it here could therefore write an audit row whose
            // `is_match` CONTRADICTS the verdict the caller was already given and
            // acted on (attendance allowed/denied). For a government attendance
            // anti-fraud trail, a log that disagrees with the enforced decision
            // is worse than a missing log, so this case is deliberately left
            // failing rather than silently wrong.
            //
            // FIX AT THE ROUTE (outside this file's scope): the route already
            // HAS `result`, `faceConfig` and `profile.photoKey` in hand at the
            // publish point — forward them in the publishF3Write payload and
            // this case becomes a straight insert of values the caller was shown.
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
            // `body` here is the RAW request body forwarded through the queue —
            // it has NOT been through the route's Zod schema, which strips
            // unknown keys. Spreading it (`{ ...body }`) would let a caller set
            // any column on hrms_face_config, tenant_id included, so the six
            // updatable fields are allow-listed field-for-field against
            // face-verification/routes.ts's PATCH schema instead. Thresholds are
            // stringified because both columns are `numeric`.
            const cfgSet: Record<string, unknown> = { updatedAt: new Date() };
            if (body.onnxEnabled !== undefined) cfgSet.onnxEnabled = body.onnxEnabled;
            if (body.onnxThreshold !== undefined) cfgSet.onnxThreshold = String(body.onnxThreshold);
            if (body.rekognitionEnabled !== undefined) cfgSet.rekognitionEnabled = body.rekognitionEnabled;
            if (body.rekognitionThreshold !== undefined) cfgSet.rekognitionThreshold = String(body.rekognitionThreshold);
            if (body.requireFaceMatch !== undefined) cfgSet.requireFaceMatch = body.requireFaceMatch;
            if (body.allowManualOverride !== undefined) cfgSet.allowManualOverride = body.allowManualOverride;
            await tx.update(hrmsFaceConfig).set(cfgSet as any)
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
