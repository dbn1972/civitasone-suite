import {
  pgSchema, uuid, text, varchar, char, bigint, integer, boolean, timestamp,
} from "drizzle-orm/pg-core";

export const utilisationSchema = pgSchema("utilisation");

export const grantUcStatements = utilisationSchema.table("grant_uc_statements", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  applicationId:  uuid("application_id").notNull(),
  period:         char("period", { length: 7 }).notNull(),   // YYYY-YY or YYYY-MM
  releasedMinor:  bigint("released_minor", { mode: "bigint" }).notNull().default(0n),
  utilisedMinor:  bigint("utilised_minor", { mode: "bigint" }).notNull().default(0n),
  varianceMinor:  bigint("variance_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  status:         varchar("status", { length: 24 }).notNull().default("submitted"),
  submittedAt:    timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  ucRef:          text("uc_ref"),                            // opaque "finance_uc:UUID"
  isImmutable:    boolean("is_immutable").notNull().default(false),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
  // 0003 hardening: UC <-> tranche linkage + validation state
  installmentNo:     integer("installment_no").notNull().default(1),
  validationStatus:  varchar("validation_status", { length: 24 }).notNull().default("pending"),
  validatedBy:       uuid("validated_by"),
  validatedAt:       timestamp("validated_at", { withTimezone: true }),
  validationRemarks: text("validation_remarks"),
});

export const grantComplianceReports = utilisationSchema.table("grant_compliance_reports", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  applicationId:  uuid("application_id").notNull(),
  period:         char("period", { length: 7 }).notNull(),
  kind:           varchar("kind", { length: 24 }).notNull().default("interim"),
  observation:    text("observation"),
  status:         varchar("status", { length: 24 }).notNull().default("submitted"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const grantAuditParas = utilisationSchema.table("grant_audit_paras", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  applicationId:  uuid("application_id").notNull(),
  auditType:      varchar("audit_type", { length: 24 }).notNull().default("internal"),
  paraNo:         text("para_no").notNull(),
  observation:    text("observation").notNull(),
  recoveryMinor:  bigint("recovery_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  status:         varchar("status", { length: 24 }).notNull().default("open"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const grantUcValidations = utilisationSchema.table("grant_uc_validations", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  ucId:         uuid("uc_id").notNull(),
  status:       varchar("status", { length: 24 }).notNull(),
  remarks:      text("remarks"),
  validatedBy:  uuid("validated_by").notNull(),
  validatedAt:  timestamp("validated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UcValidationRow    = typeof grantUcValidations.$inferSelect;
export type UcValidationInsert = typeof grantUcValidations.$inferInsert;

export type UcRow    = typeof grantUcStatements.$inferSelect;
export type UcInsert = typeof grantUcStatements.$inferInsert;

export const schema = { grantUcStatements, grantComplianceReports, grantAuditParas, grantUcValidations };
