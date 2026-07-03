/**
 * custom_domains module — Drizzle schema. Lives in its OWN Postgres schema `custom_domains`.
 * L2 rule: this module's repo queries ONLY `custom_domains.*`.
 */
import { pgSchema, uuid, varchar, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const customDomainsSchema = pgSchema("custom_domains");

export const domainStatusEnum = customDomainsSchema.enum("domain_status", [
  "pending_verification", "verified", "active", "failed", "revoked",
]);

export const verificationMethodEnum = customDomainsSchema.enum("verification_method", [
  "dns_txt", "dns_cname",
]);

export const sslStatusEnum = customDomainsSchema.enum("ssl_status", [
  "pending", "issued", "expired",
]);

export const customDomains = customDomainsSchema.table("custom_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  domain: varchar("domain", { length: 253 }).notNull(),
  status: domainStatusEnum("status").notNull().default("pending_verification"),
  verificationToken: varchar("verification_token", { length: 100 }).notNull(),
  verificationMethod: verificationMethodEnum("verification_method").notNull().default("dns_txt"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  sslStatus: sslStatusEnum("ssl_status").notNull().default("pending"),
  sslExpiresAt: timestamp("ssl_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CustomDomainRow = typeof customDomains.$inferSelect;
export type CustomDomainInsert = typeof customDomains.$inferInsert;

export const schema = { customDomains };
