/**
 * CR-MKT-05 — A/B experiments, variants and engagement events.
 *
 * No PII: engagement is attributed to a delivery id and a hashed subject key,
 * never to an email address. `subjectKey` is an opaque recipient identifier
 * (uuid) supplied by the caller.
 */
import { pgSchema, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";

export const experimentsSchema = pgSchema("experiments");

export const experiments = experimentsSchema.table("experiments", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            varchar("name", { length: 200 }).notNull(),
  /** draft | running | concluded */
  status:          varchar("status", { length: 16 }).notNull().default("running"),
  winnerVariantId: uuid("winner_variant_id"),
  winnerMarginPct: integer("winner_margin_pct"),
  concludedAt:     timestamp("concluded_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const experimentVariants = experimentsSchema.table("experiment_variants", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  experimentId:  uuid("experiment_id").notNull(),
  variantKey:    varchar("variant_key", { length: 64 }).notNull(),
  allocationPct: integer("allocation_pct").notNull(),
  templateId:    uuid("template_id"),
  sentCount:     integer("sent_count").notNull().default(0),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const experimentEvents = experimentsSchema.table("experiment_events", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  experimentId: uuid("experiment_id").notNull(),
  variantId:    uuid("variant_id").notNull(),
  deliveryId:   uuid("delivery_id"),
  /** open | click */
  eventType:    varchar("event_type", { length: 16 }).notNull(),
  /** 1-based link index within the body — drives the click heatmap. */
  linkPosition: integer("link_position"),
  linkUrl:      text("link_url"),
  occurredAt:   timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type ExperimentRow = typeof experiments.$inferSelect;
export type ExperimentInsert = typeof experiments.$inferInsert;
export type ExperimentVariantRow = typeof experimentVariants.$inferSelect;
export type ExperimentVariantInsert = typeof experimentVariants.$inferInsert;
export type ExperimentEventRow = typeof experimentEvents.$inferSelect;
export type ExperimentEventInsert = typeof experimentEvents.$inferInsert;

export const experimentsModuleSchema = { experiments, experimentVariants, experimentEvents };
