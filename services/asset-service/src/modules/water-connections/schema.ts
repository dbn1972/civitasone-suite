import {
  pgSchema, uuid, text, integer, bigint, char, varchar, boolean, date, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const waterConnectionsSchema = pgSchema("water_connections");

export const assetWaterApplications = waterConnectionsSchema.table("asset_water_applications", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  applicationNumber: text("application_number").notNull(),
  status:            varchar("status", { length: 32 }).notNull().default("draft"),
  applicantName:     text("applicant_name").notNull(),
  applicantPhone:    text("applicant_phone").notNull(),
  propertyId:        text("property_id"),
  connectionType:    varchar("connection_type", { length: 16 }).notNull(),
  pipeSize:          varchar("pipe_size", { length: 16 }),
  address:           jsonb("address"),
  documents:         jsonb("documents"),
  feeMinor:          bigint("fee_minor", { mode: "bigint" }).notNull().default(0n),
  feeCurrency:       char("fee_currency", { length: 3 }).notNull().default("INR"),
  feePaid:           boolean("fee_paid").notNull().default(false),
  feeTransactionId:  text("fee_transaction_id"),
  feasibilityReport: jsonb("feasibility_report"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export const assetWaterConnections = waterConnectionsSchema.table("asset_water_connections", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  connectionNumber: text("connection_number").notNull(),
  applicationId:    uuid("application_id").notNull(),
  meterId:          text("meter_id"),
  status:           varchar("status", { length: 16 }).notNull().default("active"),
  connectionType:   varchar("connection_type", { length: 16 }).notNull(),
  pipeSize:         varchar("pipe_size", { length: 16 }),
  installationDate: date("installation_date"),
  activationDate:   date("activation_date"),
  address:          jsonb("address"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export type WaterApplicationRow    = typeof assetWaterApplications.$inferSelect;
export type WaterApplicationInsert = typeof assetWaterApplications.$inferInsert;
export type WaterConnectionRow     = typeof assetWaterConnections.$inferSelect;
export type WaterConnectionInsert  = typeof assetWaterConnections.$inferInsert;

export const schema = { assetWaterApplications, assetWaterConnections };
