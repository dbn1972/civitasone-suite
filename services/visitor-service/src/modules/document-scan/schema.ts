/**
 * visitor-service: document-scan Drizzle schema.
 *
 * Defines `visitor.scan_sessions` and `visitor.ocr_results` tables for the
 * document scan module. PII fields (full_name, date_of_birth,
 * id_document_number, address) are encrypted at rest using AES-256-GCM
 * via `encryptedText()` for DPDP Act compliance.
 *
 * Requirements validated: 6.1, 6.3, 6.9, 10.3
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const visitorSchema = pgSchema("visitor");

// ── visitor.scan_sessions ─────────────────────────────────────────────────
export const scanSessions = visitorSchema.table("scan_sessions", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  deviceId:        uuid("device_id").notNull(),    // FK → devices
  status:          varchar("status", { length: 16 }).notNull().default("uploading"),
  // status: uploading | processing | completed | failed
  imageStorageKey: text("image_storage_key"),       // S3/MinIO key
  imageDeleted:    boolean("image_deleted").notNull().default(false),
  imageExpiresAt:  timestamp("image_expires_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── visitor.ocr_results ───────────────────────────────────────────────────
export const ocrResults = visitorSchema.table("ocr_results", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  scanSessionId:      uuid("scan_session_id").notNull(), // FK → scan_sessions
  fullName:           encryptedText("full_name"),         // PII encrypted
  dateOfBirth:        encryptedText("date_of_birth"),     // PII encrypted
  idDocumentNumber:   encryptedText("id_document_number"),// PII encrypted
  idDocumentType:     varchar("id_document_type", { length: 24 }),
  // id_document_type: aadhaar | pan | driving_license | voter_id
  address:            encryptedText("address"),           // PII encrypted
  photoRegionKey:     text("photo_region_key"),           // S3 key for cropped face
  confidenceScores:   jsonb("confidence_scores").$type<Record<string, number>>(),
  lowConfidence:      boolean("low_confidence").notNull().default(false),
  blacklistMatch:     boolean("blacklist_match").notNull().default(false),
  watchlistMatch:     boolean("watchlist_match").notNull().default(false),
  verificationStatus: varchar("verification_status", { length: 16 }).default("pending"),
  // verification_status: pending | verified | failed | unavailable
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Type exports ──────────────────────────────────────────────────────────
export type ScanSessionRow = typeof scanSessions.$inferSelect;
export type ScanSessionInsert = typeof scanSessions.$inferInsert;
export type OcrResultRow = typeof ocrResults.$inferSelect;
export type OcrResultInsert = typeof ocrResults.$inferInsert;

export const schema = { scanSessions, ocrResults };
