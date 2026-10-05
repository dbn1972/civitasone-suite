import {
  pgSchema,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  text,
} from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

/**
 * One Voice-of-Customer reading per interaction.
 *
 * `activityId` is an opaque reference, not a foreign key — the same rule the
 * rest of the suite follows for cross-module refs. `excerpt` is a truncated
 * copy of the scored text so an officer can see what produced a reading
 * without the aggregate having to join back to the activity.
 */
export const interactionSentiments = crmSchema.table("interaction_sentiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  activityId: uuid("activity_id").notNull(),
  activityType: varchar("activity_type", { length: 16 })
    .notNull()
    .default("note"),
  contactId: uuid("contact_id"),
  dealId: uuid("deal_id"),
  polarity: varchar("polarity", { length: 16 }).notNull(),
  score: integer("score").notNull(),
  themes: jsonb("themes").$type<string[]>().notNull().default([]),
  excerpt: text("excerpt"),
  /** Which scorer produced this reading, so a model change is traceable. */
  model: varchar("model", { length: 32 }).notNull().default("lexicon-v1"),
  analysedAt: timestamp("analysed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type InteractionSentimentRow = typeof interactionSentiments.$inferSelect;
export type InteractionSentimentInsert =
  typeof interactionSentiments.$inferInsert;

export interface InteractionSentimentView {
  id: string;
  tenantId: string;
  activityId: string;
  activityType: string;
  contactId: string | null;
  dealId: string | null;
  polarity: string;
  score: number;
  themes: string[];
  excerpt: string | null;
  model: string;
  analysedAt: string;
  version: number;
}

export const schema = { interactionSentiments };

/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — a citizen's self-reported service
 * rating (1-5) + optional comment, optionally "regarding" a service request.
 *
 * Distinct from {@link interactionSentiments}: that is model-scored from logged
 * interactions; this is the citizen's own voice, surfaced as a SEPARATE
 * "Citizen ratings" tile. `serviceRequestId` is an opaque reference, not a FK.
 * `comment` is free text — shown unmasked only to CRM admins (CRM_PII_READ_ROLES).
 */
export const citizenFeedback = crmSchema.table("citizen_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  serviceRequestId: uuid("service_request_id"),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  submissionType: varchar("submission_type", { length: 16 })
    .notNull()
    .default("anonymous"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CitizenFeedbackRow = typeof citizenFeedback.$inferSelect;
export type CitizenFeedbackInsert = typeof citizenFeedback.$inferInsert;

export const feedbackSchema = { citizenFeedback };
