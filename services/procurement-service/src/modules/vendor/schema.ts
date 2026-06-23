import { pgSchema, uuid, text, integer, boolean, varchar, timestamp } from "drizzle-orm/pg-core";

export const vendorSchema = pgSchema("vendor");

export const procurementVendors = vendorSchema.table("procurement_vendors", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            text("name").notNull(),
  gstin:           text("gstin"),
  pan:             text("pan"),
  email:           text("email"),
  phone:           text("phone"),
  vendorType:      varchar("vendor_type", { length: 24 }).notNull().default("registered"),
  mse:             boolean("mse").notNull().default(false),
  msme:            boolean("msme").notNull().default(false),
  udyamNo:         text("udyam_no"),
  bankAccount:     text("bank_account"),
  ifsc:            text("ifsc"),
  blacklistReason: text("blacklist_reason"),
  kycStatus:       varchar("kyc_status", { length: 20 }).notNull().default("pending"),
  kycVerifiedAt:   timestamp("kyc_verified_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const procurementVendorDocs = vendorSchema.table("procurement_vendor_docs", {
  id:        uuid("id").primaryKey().defaultRandom(),
  vendorId:  uuid("vendor_id").notNull(),
  tenantId:  uuid("tenant_id").notNull(),
  docType:   text("doc_type").notNull(),
  fileRef:   text("file_ref").notNull(),
  verified:  boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const procurementEmpanelment = vendorSchema.table("procurement_empanelment", {
  id:          uuid("id").primaryKey().defaultRandom(),
  vendorId:    uuid("vendor_id").notNull(),
  tenantId:    uuid("tenant_id").notNull(),
  category:    text("category").notNull(),
  empanelDate: text("empanel_date").notNull(),
  validUntil:  text("valid_until"),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type VendorRow    = typeof procurementVendors.$inferSelect;
export type VendorInsert = typeof procurementVendors.$inferInsert;

export const schema = { procurementVendors, procurementVendorDocs, procurementEmpanelment };
