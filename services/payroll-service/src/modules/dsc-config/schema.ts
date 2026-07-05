import {
  pgSchema, uuid, text, timestamp,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

const payrollSchema = pgSchema("payroll");

export const dscConfig = payrollSchema.table("dsc_config", {
  tenantId:           uuid("tenant_id").primaryKey(),
  storageRef:         text("storage_ref").notNull(),
  passphrase:         encryptedText("passphrase").notNull(),
  subjectCn:          text("subject_cn").notNull(),
  serialNumber:       text("serial_number").notNull(),
  notBefore:          timestamp("not_before", { withTimezone: true }).notNull(),
  notAfter:           timestamp("not_after", { withTimezone: true }).notNull(),
  sha256Fingerprint:  text("sha256_fingerprint").notNull(),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
});

export type DscConfigRow = typeof dscConfig.$inferSelect;
export type DscConfigInsert = typeof dscConfig.$inferInsert;

export const schema = { dscConfig };
