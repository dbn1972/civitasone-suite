import {
  pgSchema, uuid, text, integer, timestamp, boolean, jsonb,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const portalSchema = pgSchema("portal");

export const citizenProfiles = portalSchema.table("citizen_profiles", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            text("name").notNull(),
  // P0-1 (DPDP): email/mobile/digilocker_token/address are AES-256-GCM encrypted
  // at rest (app-layer envelope). The column type is text; the application value
  // is cleartext (decrypted on read, encrypted on write). mobile widened from
  // varchar(16) to text to hold ciphertext (migration 0006).
  email:           encryptedText("email"),
  mobile:          encryptedText("mobile"),
  digilockerToken: encryptedText("digilocker_token"),
  address:         encryptedText("address"),
  ward:            text("ward"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const citizenServiceCategories = portalSchema.table("citizen_service_categories", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  name:        text("name").notNull(),
  description: text("description"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const citizenServices = portalSchema.table("citizen_services", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  categoryId:    uuid("category_id").notNull(),
  name:          text("name").notNull(),
  description:   text("description"),
  requiredDocs:  jsonb("required_docs").$type<string[]>().notNull().default([]),
  departmentRef: text("department_ref"),
  active:        boolean("active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type ProfileRow    = typeof citizenProfiles.$inferSelect;
export type ProfileInsert = typeof citizenProfiles.$inferInsert;
export type ServiceRow    = typeof citizenServices.$inferSelect;
export type ServiceInsert = typeof citizenServices.$inferInsert;

export const schema = { citizenProfiles, citizenServiceCategories, citizenServices };
