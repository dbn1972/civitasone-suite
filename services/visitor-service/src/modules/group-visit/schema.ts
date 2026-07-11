/**
 * visitor-service: group-visit Drizzle schema (migration 0005).
 *
 * Mirrors `services/visitor-service/migrations/0005_group_recurring.sql`
 * exactly (column names, types, defaults, nullability) for
 * `visitor.group_visits` and `visitor.group_members`.
 *
 * `memberName` and `identityDocRef` on `group_members` are DPDP-encrypted
 * PII (AES-256-GCM envelope via `encryptedText()`); `identityDocHash` is a
 * deterministic HMAC blind index (plain text, NOT encrypted) so
 * blacklist/watchlist identity-document lookups can match without
 * decrypting any PII — matches the convention in
 * `modules/blacklist/schema.ts` and `modules/visit-request/schema.ts`.
 *
 * `groupVisitId` FKs to `groupVisits.id` (same module, so `.references()` is
 * used). `visitRequestId` (on `group_visits`) and `passId` (on
 * `group_members`) are cross-module FKs (visit-request / digital-pass
 * modules) — per the established CivitasOne pattern, cross-module FK
 * columns are declared as plain `uuid` without a Drizzle `.references()`
 * call (see e.g. `modules/digital-pass/schema.ts` locationId).
 *
 * `visitorSchema` is defined here via its own `pgSchema("visitor")` call —
 * per the established CivitasOne multi-module pattern, each module's
 * `schema.ts` calls `pgSchema("visitor")` independently (see
 * `modules/blacklist/schema.ts`); Drizzle treats same-named `pgSchema()`
 * calls as referring to the same Postgres schema.
 */
import { pgSchema, uuid, varchar, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const visitorSchema = pgSchema("visitor");

export const groupVisits = visitorSchema.table("group_visits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  groupName: varchar("group_name", { length: 200 }).notNull(),
  leadVisitorId: uuid("lead_visitor_id"),
  memberCount: integer("member_count").notNull(),
  purpose: text("purpose").notNull(),
  visitRequestId: uuid("visit_request_id"), // cross-module FK -> visitor.visit_requests(id)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const groupMembers = visitorSchema.table("group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  groupVisitId: uuid("group_visit_id")
    .notNull()
    .references(() => groupVisits.id),
  memberName: encryptedText("member_name").notNull(), // encrypted (enc:v2:... envelope)
  identityDocType: varchar("identity_doc_type", { length: 24 }),
  identityDocRef: encryptedText("identity_doc_ref"), // encrypted, nullable
  identityDocHash: text("identity_doc_hash"), // HMAC blind index, plain text (not encrypted)
  passId: uuid("pass_id"), // cross-module FK -> visitor.digital_passes(id)
  blacklisted: boolean("blacklisted").notNull().default(false),
  checkedIn: boolean("checked_in").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type GroupVisitRow = typeof groupVisits.$inferSelect;
export type GroupVisitInsert = typeof groupVisits.$inferInsert;
export type GroupMemberRow = typeof groupMembers.$inferSelect;
export type GroupMemberInsert = typeof groupMembers.$inferInsert;

export const schema = { groupVisits, groupMembers };
