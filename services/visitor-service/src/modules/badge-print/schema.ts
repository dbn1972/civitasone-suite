/**
 * visitor-service: badge-print Drizzle schema (migration 0008).
 *
 * Defines the `visitor.badge_templates` and `visitor.print_jobs` tables
 * for the badge printing module of the hardware integration feature.
 *
 * Badge templates hold raw ZPL/ESC·POS markup with variable placeholders
 * (e.g. {{visitor_name}}, {{qr_code_data}}). Print jobs reference a
 * template + digital pass and store the fully rendered payload ready for
 * the printer device to consume.
 *
 * Requirements validated: 4.1, 4.6, 5.1, 5.10
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const visitorSchema = pgSchema("visitor");

// ── visitor.badge_templates ───────────────────────────────────────────────
export const badgeTemplates = visitorSchema.table("badge_templates", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  name:              varchar("name", { length: 128 }).notNull(),
  printerLanguage:   varchar("printer_language", { length: 8 }).notNull(),
  // printer_language: zpl | escpos
  templateBody:      text("template_body").notNull(),
  // Raw ZPL/ESC·POS with placeholders (e.g. {{visitor_name}}, {{qr_code_data}})
  badgeWidthMm:      integer("badge_width_mm").notNull().default(54),
  badgeHeightMm:     integer("badge_height_mm").notNull().default(86),
  status:            varchar("status", { length: 12 }).notNull().default("active"),
  // status: active | archived
  visitorCategory:   varchar("visitor_category", { length: 16 }).notNull().default("default"),
  // visitor_category: default | walk_in | pre_registered | vip | contractor | group
  templateVersion:   integer("template_version").notNull().default(1),
  previousVersionId: uuid("previous_version_id"), // self-FK for version chain (nullable)
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

// ── visitor.print_jobs ────────────────────────────────────────────────────
export const printJobs = visitorSchema.table("print_jobs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  deviceId:        uuid("device_id").notNull(),    // FK → visitor.devices
  passId:          uuid("pass_id").notNull(),       // FK → visitor.digital_passes
  templateId:      uuid("template_id").notNull(),   // FK → visitor.badge_templates
  status:          varchar("status", { length: 16 }).notNull().default("queued"),
  // status: queued | in_progress | completed | failed
  priority:        varchar("priority", { length: 12 }).notNull().default("standard"),
  // priority: standard | high
  renderedPayload: text("rendered_payload"),        // Final ZPL/ESC·POS (null until rendered)
  retryCount:      integer("retry_count").notNull().default(0),
  nextRetryAt:     timestamp("next_retry_at", { withTimezone: true }),
  completedAt:     timestamp("completed_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:         integer("version").notNull().default(1),
});

// ── Types ─────────────────────────────────────────────────────────────────
export type BadgeTemplateRow = typeof badgeTemplates.$inferSelect;
export type BadgeTemplateInsert = typeof badgeTemplates.$inferInsert;
export type PrintJobRow = typeof printJobs.$inferSelect;
export type PrintJobInsert = typeof printJobs.$inferInsert;

export const schema = { badgeTemplates, printJobs };
