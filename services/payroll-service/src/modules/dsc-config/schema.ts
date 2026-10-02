import {
  pgSchema, uuid, text, timestamp,
} from "drizzle-orm/pg-core";

const payrollSchema = pgSchema("payroll");

/**
 * Read-cache resource name for dsc_config rows (repo.ts + consumer.ts).
 * v2: the cached row now carries the SEALED passphrase (passphraseSealed).
 * Pre-v2 "dsc_config" entries held the DECRYPTED passphrase; the key bump
 * guarantees they are never read back (they age out via CACHE_TTL, and
 * scripts/backfill-dsc-secrets.mjs deletes them explicitly).
 */
export const DSC_CACHE_RESOURCE = "dsc_config:v2";

export const dscConfig = payrollSchema.table("dsc_config", {
  tenantId:           uuid("tenant_id").primaryKey(),
  storageRef:         text("storage_ref").notNull(),
  /**
   * SEALED keystore passphrase ("enc:v2:<keyid>:..." envelope, see secret.ts).
   * Deliberately a plain `text` column, NOT the transparent `encryptedText`
   * customType: the application value stays ciphertext everywhere (queue
   * payload, consumer, read cache) and is only opened by loader.ts at the
   * moment of signing. Legacy pre-backfill rows may still hold plaintext;
   * openDscPassphrase() passes those through. Migration 0051 adds a NOT VALID
   * CHECK so no NEW plaintext row can be written.
   */
  passphraseSealed:   text("passphrase").notNull(),
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
