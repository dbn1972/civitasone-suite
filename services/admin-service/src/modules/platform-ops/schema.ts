import { pgSchema, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";

const tenantsSchema = pgSchema("tenants");

// Migration 0045: the platform tenant-onboarding queue. `tenantId` is the
// OPERATOR tenant that owns the queue (RLS scope), not the tenant being provisioned.
export const onboardingRequests = tenantsSchema.table("onboarding_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  orgName: varchar("org_name", { length: 200 }).notNull(),
  contactName: varchar("contact_name", { length: 200 }).notNull().default(""),
  contactEmail: varchar("contact_email", { length: 254 }).notNull().default(""),
  stage: varchar("stage", { length: 24 }).notNull().default("new request"),
  assignedTo: uuid("assigned_to"),
  assignedToName: varchar("assigned_to_name", { length: 200 }),
  provisionedTenantId: uuid("provisioned_tenant_id"),
  notes: text("notes"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type OnboardingRequestRow = typeof onboardingRequests.$inferSelect;
export const schema = { onboardingRequests };
