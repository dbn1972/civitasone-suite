/**
 * contacts module — Drizzle schema. Lives in its OWN Postgres schema `crm`.
 */
import { pgSchema, uuid, varchar, integer, timestamp, boolean, date, jsonb, text } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const crmSchema = pgSchema("crm");

export const accounts = crmSchema.table("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  industry: varchar("industry", { length: 64 }),
  website: varchar("website", { length: 320 }),
  // Business identifiers (DQ-001/003) — cleartext (not PII), normalized-indexed.
  gstin: varchar("gstin", { length: 15 }),
  pan: varchar("pan", { length: 10 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  // Self-referencing org hierarchy (migration 0020). Null = root account.
  parentId: uuid("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const contacts = crmSchema.table("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  // PII at rest: AES-256-GCM ciphertext (cleartext in app via customType).
  email: encryptedText("email"),
  phone: encryptedText("phone"),
  // Deterministic blind index over normalized email — backs the per-tenant
  // unique constraint + bulk-import de-dup while email itself is ciphertext.
  emailIdx: text("email_idx"),
  // Business identifiers + PIN (DQ-001/003). GSTIN/PAN are NOT PII — cleartext,
  // with a per-tenant normalized index for exact-match dedup.
  gstin: varchar("gstin", { length: 15 }),
  pan: varchar("pan", { length: 10 }),
  pincode: varchar("pincode", { length: 6 }),
  // Lead score (0-100), maintained by the scoring consumer.
  score: integer("score"),
  company: varchar("company", { length: 200 }),
  designation: varchar("designation", { length: 120 }),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 2 }).default("IN"),
  leadStatus: varchar("lead_status", { length: 24 }).notNull().default("new"),
  leadSource: varchar("lead_source", { length: 64 }),
  ownerId: uuid("owner_id"),
  accountId: uuid("account_id"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  consentDate: date("consent_date"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ContactRow = typeof contacts.$inferSelect;
export type ContactInsert = typeof contacts.$inferInsert;
export type AccountRow = typeof accounts.$inferSelect;
export type AccountInsert = typeof accounts.$inferInsert;

export type ContactView = {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  designation: string | null;
  city: string | null;
  country: string | null;
  gstin: string | null;
  pan: string | null;
  pincode: string | null;
  leadStatus: string;
  leadSource: string | null;
  ownerId: string | null;
  accountId: string | null;
  tags: string[];
  marketingConsent: boolean;
  consentDate: string | null;
  lastActivityAt: string | null;
  status: string;
  version: number;
};

export type ContactDetailView = {
  id: string;
  name: string;
  organization?: string;
  email?: string;
  phone?: string;
  designation?: string;
  city?: string;
  leadStatus?: string;
  marketingConsent?: boolean;
  lastActivityDate?: string;
  tags: string[];
  deals: Array<{ id: string; dealName: string; stage: string; amount: number }>;
  activityTimeline: Array<{
    id: string;
    type: string;
    subject: string;
    dueDate?: string;
    completedAt?: string;
    status: string;
  }>;
};

export const schema = { contacts, accounts };
