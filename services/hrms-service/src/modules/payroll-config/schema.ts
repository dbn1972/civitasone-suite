import {
  pgSchema, uuid, varchar, text, boolean, timestamp,
} from "drizzle-orm/pg-core";

export const payrollConfigSchema = pgSchema("payroll");

/**
 * Salary-slip HTML template configuration. Physically owned by hrms-service
 * (created by migrations/0008_recruitment_payroll_gaps.sql) even though the
 * `payroll` Postgres schema name suggests payroll-service — payroll-service
 * connects to a completely separate database (civitas_payroll) with no
 * dblink/postgres_fdw link to this one, so it cannot query this table
 * directly. It reaches this data via the internal HTTP endpoint in
 * ../internal/routes.ts instead (GET /v1/hrms/internal/payroll/slip-templates/default),
 * the same pattern payroll-service already uses for payroll-input and
 * employee-summaries. See services/payroll-service/src/shared/hrms-client.ts.
 */
export const payrollSlipTemplates = payrollConfigSchema.table("payroll_slip_templates", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  name:          varchar("name", { length: 256 }).notNull(),
  templateHtml:  text("template_html").notNull(),
  isDefault:     boolean("is_default").notNull().default(false),
  headerLogoKey: varchar("header_logo_key", { length: 1024 }),
  footerText:    text("footer_text"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export type PayrollSlipTemplateRow = typeof payrollSlipTemplates.$inferSelect;

export const schema = { payrollSlipTemplates };
