import { pgSchema, uuid, text, varchar, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const filesSchema = pgSchema("files");

export const estabSignConfig = filesSchema.table("estab_sign_config", {
  tenantId:       uuid("tenant_id").primaryKey(),
  mode:           varchar("mode", { length: 16 }).notNull().default("disabled"),
  allowedMethods: jsonb("allowed_methods").$type<string[]>().notNull().default(["aadhaar_esign", "dsc"]),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:      uuid("updated_by"),
});

export const estabSignature = filesSchema.table("estab_signature", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  subjectType:         varchar("subject_type", { length: 16 }).notNull(),
  subjectId:           uuid("subject_id").notNull(),
  fileId:              uuid("file_id"),
  docHash:             text("doc_hash").notNull(),
  method:              varchar("method", { length: 24 }).notNull(),
  provider:            varchar("provider", { length: 48 }).notNull(),
  pkcs7:               text("pkcs7").notNull(),
  certSerial:          text("cert_serial"),
  certSubject:         text("cert_subject"),
  certIssuer:          text("cert_issuer"),
  signerId:            uuid("signer_id").notNull(),
  signedAt:            timestamp("signed_at", { withTimezone: true }).notNull(),
  revocationCheckedAt: timestamp("revocation_checked_at", { withTimezone: true }),
  valid:               boolean("valid").notNull().default(true),
  txnRef:              text("txn_ref"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SignConfigRow = typeof estabSignConfig.$inferSelect;
export type SignatureRow = typeof estabSignature.$inferSelect;
export type SignatureInsert = typeof estabSignature.$inferInsert;

export const schema = { estabSignConfig, estabSignature };
