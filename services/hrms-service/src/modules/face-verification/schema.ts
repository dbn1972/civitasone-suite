import { pgSchema, uuid, varchar, integer, boolean, numeric, timestamp, customType } from "drizzle-orm/pg-core";

const empSchema = pgSchema("employee");
const attSchema = pgSchema("attendance");

const bytea = customType<{ data: Buffer | null }>({ dataType: () => "bytea" });

export const hrmsProfilePhotos = empSchema.table("hrms_profile_photos", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  employeeId:      uuid("employee_id").notNull(),
  photoKey:        varchar("photo_key", { length: 1024 }).notNull(),
  photoBucket:     varchar("photo_bucket", { length: 256 }).notNull().default("civitasone-photos"),
  faceEmbedding:   bytea("face_embedding"),
  embeddingModel:  varchar("embedding_model", { length: 64 }),
  uploadedAt:      timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedBy:      uuid("verified_by"),
  verifiedAt:      timestamp("verified_at", { withTimezone: true }),
  isActive:        boolean("is_active").notNull().default(true),
});

export const hrmsFaceVerificationLog = attSchema.table("hrms_face_verification_log", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  employeeId:           uuid("employee_id").notNull(),
  geoAttendanceId:      uuid("geo_attendance_id"),
  selfieKey:            varchar("selfie_key", { length: 1024 }).notNull(),
  profilePhotoKey:      varchar("profile_photo_key", { length: 1024 }).notNull(),
  verificationMethod:   varchar("verification_method", { length: 16 }).notNull(),
  similarityScore:      numeric("similarity_score", { precision: 5, scale: 4 }),
  confidenceThreshold:  numeric("confidence_threshold", { precision: 5, scale: 4 }).notNull(),
  isMatch:              boolean("is_match").notNull(),
  rekognitionUsed:      boolean("rekognition_used").notNull().default(false),
  onnxScore:            numeric("onnx_score", { precision: 5, scale: 4 }),
  rekognitionScore:     numeric("rekognition_score", { precision: 5, scale: 4 }),
  processingMs:         integer("processing_ms"),
  failureReason:        varchar("failure_reason", { length: 1024 }),
  verifiedAt:           timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsFaceConfig = attSchema.table("hrms_face_config", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  onnxEnabled:          boolean("onnx_enabled").notNull().default(true),
  onnxThreshold:        numeric("onnx_threshold", { precision: 5, scale: 4 }).notNull().default("0.7500"),
  rekognitionEnabled:   boolean("rekognition_enabled").notNull().default(true),
  rekognitionThreshold: numeric("rekognition_threshold", { precision: 5, scale: 4 }).notNull().default("0.7000"),
  requireFaceMatch:     boolean("require_face_match_for_attendance").notNull().default(true),
  allowManualOverride:  boolean("allow_manual_override").notNull().default(true),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
