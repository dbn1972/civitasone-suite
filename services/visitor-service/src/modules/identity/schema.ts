/**
 * Drizzle table definition for visitor.security_incidents.
 *
 * Matches migration 0006_incidents_dpdp_analytics.sql exactly. This table
 * is owned by the identity module because the primary write path originates
 * from identity-verification failures (face_match_fail), though other
 * modules (blacklist, material-pass, check-in) also insert rows for their
 * respective incident types.
 */
import { pgSchema, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const visitorSchema = pgSchema("visitor");

export const securityIncidents = visitorSchema.table("security_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  incidentType: varchar("incident_type", { length: 32 }).notNull(),
  // incident_type: blacklist_match | watchlist_alert | material_discrepancy |
  //                unauthorized_zone | overstay | face_match_fail | forced_entry
  relatedPassId: uuid("related_pass_id"),
  relatedVisitorId: uuid("related_visitor_id"),
  description: text("description").notNull(),
  severity: varchar("severity", { length: 8 }).notNull().default("medium"),
  // severity: low | medium | high | critical
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type SecurityIncidentRow = typeof securityIncidents.$inferSelect;
export type SecurityIncidentInsert = typeof securityIncidents.$inferInsert;

export const schema = { securityIncidents };
