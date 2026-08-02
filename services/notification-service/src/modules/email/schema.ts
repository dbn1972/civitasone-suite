/**
 * CR-MKT-04 — sending-domain registration + domain-authentication health history.
 *
 * No PII here: a sending domain is an organisational identifier, not a personal
 * one, and the check results hold only DNS record fragments.
 */
import { pgSchema, uuid, varchar, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const emailSchema = pgSchema("email");

export const sendingDomains = emailSchema.table("sending_domains", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  domain:        varchar("domain", { length: 253 }).notNull(),
  dkimSelector:  varchar("dkim_selector", { length: 63 }).notNull(),
  dkimValue:     text("dkim_value").notNull(),
  spfInclude:    varchar("spf_include", { length: 253 }).notNull(),
  dmarcPolicy:   varchar("dmarc_policy", { length: 16 }).notNull().default("none"),
  /** Latest rolled-up health: healthy | degraded | failing | unknown. */
  health:        varchar("health", { length: 16 }).notNull().default("unknown"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  enabled:       boolean("enabled").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const domainAuthChecks = emailSchema.table("domain_auth_checks", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  sendingDomainId: uuid("sending_domain_id").notNull(),
  dkimStatus:      varchar("dkim_status", { length: 16 }).notNull(),
  spfStatus:       varchar("spf_status", { length: 16 }).notNull(),
  dmarcStatus:     varchar("dmarc_status", { length: 16 }).notNull(),
  health:          varchar("health", { length: 16 }).notNull(),
  /** Raw TXT strings observed, for operator diagnosis. */
  observed:        jsonb("observed").$type<Record<string, string[]>>(),
  /** Who submitted this result: scheduled | manual. */
  source:          varchar("source", { length: 16 }).notNull().default("scheduled"),
  checkedAt:       timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type SendingDomainRow = typeof sendingDomains.$inferSelect;
export type SendingDomainInsert = typeof sendingDomains.$inferInsert;
export type DomainAuthCheckRow = typeof domainAuthChecks.$inferSelect;
export type DomainAuthCheckInsert = typeof domainAuthChecks.$inferInsert;

export const emailModuleSchema = { sendingDomains, domainAuthChecks };
