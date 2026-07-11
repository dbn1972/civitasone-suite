// modules/visit-request/schema.ts
// Drizzle table definition for visitor.visit_requests, matching migration
// 0002_visit_requests_digital_passes.sql exactly (column names, nullability,
// defaults). PII columns (visitor_name, visitor_phone, visitor_email,
// identity_doc_ref) use encryptedText() so the app layer transparently
// encrypts on write / decrypts on read (AES-256-GCM envelope) per DPDP
// Requirement 18.2.
import { pgSchema, uuid, varchar, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

// Multiple pgSchema("visitor") calls across this service's module files are
// expected — Drizzle allows re-declaring the same schema name in different
// files (established CivitasOne multi-module pattern, see workflow-service).
export const visitorSchema = pgSchema("visitor");

export const visitRequests = visitorSchema.table("visit_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  visitorId: uuid("visitor_id"),
  hostEmployeeId: uuid("host_employee_id").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending_approval"),
  // status: pending_approval | pre_approved | approved | rejected | cancelled | auto_rejected | no_show
  purpose: text("purpose"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  passType: varchar("pass_type", { length: 16 }).notNull().default("single"),
  // pass_type: single | multi_day | recurring | event
  identityVerified: boolean("identity_verified").notNull().default(false),
  identityMethod: varchar("identity_method", { length: 24 }),
  // identity_method: digilocker | aadhaar_face | manual | none
  trackingRef: varchar("tracking_ref", { length: 12 }),
  groupVisitId: uuid("group_visit_id"),
  permittedAreas: jsonb("permitted_areas").$type<string[]>().notNull().default([]),
  rejectionReason: text("rejection_reason"),
  visitorCategory: varchar("visitor_category", { length: 16 }).notNull().default("standard"),
  // visitor_category: standard | vip | contractor | delegation
  source: varchar("source", { length: 16 }).notNull().default("portal"),
  // source: portal | host_preregister | kiosk | mobile
  // Fix 3 — non-blocking fuzzy/alias screening review flag (migration 0012). Set
  // true at submission when a near-miss name matched an active blacklist/watchlist
  // entry; the guard reviews it (the exact blind-index match still hard-blocks).
  screeningReview: boolean("screening_review").notNull().default(false),
  screeningReviewNote: text("screening_review_note"),
  // PII fields (encrypted at rest, AES-256-GCM envelope via encryptedText())
  visitorName: encryptedText("visitor_name").notNull(),
  visitorPhone: encryptedText("visitor_phone").notNull(),
  visitorEmail: encryptedText("visitor_email"),
  identityDocType: varchar("identity_doc_type", { length: 24 }),
  identityDocRef: encryptedText("identity_doc_ref"),
  photoRef: text("photo_ref"), // S3/MinIO key (photo itself encrypted at rest by the object store)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
  erasureRequestedAt: timestamp("erasure_requested_at", { withTimezone: true }),
});

export type VisitRequestRow = typeof visitRequests.$inferSelect;
export type VisitRequestInsert = typeof visitRequests.$inferInsert;

export const schema = { visitRequests };
