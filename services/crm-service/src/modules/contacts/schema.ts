/**
 * contacts module — Drizzle schema. Lives in its OWN Postgres schema `crm`.
 */
import { pgSchema, uuid, varchar, integer, timestamp, boolean, date, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const accounts = crmSchema.table("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  industry: varchar("industry", { length: 64 }),
  website: varchar("website", { length: 320 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
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
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 32 }),
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
