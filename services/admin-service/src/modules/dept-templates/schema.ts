/**
 * ORG-07 — department template clone. Drizzle schema.
 *
 * Own Postgres schema `dept_template` (L2 rule: this module queries only
 * `dept_template.*`).
 *
 *   department_templates       → a department's configuration captured as a
 *                                reusable, tenant-scoped template. `droppedRefs`
 *                                records every reference removed because it
 *                                pointed outside this tenant.
 *   department_instantiations  → one row per department created from a template.
 *                                `idempotencyKey` is UNIQUE per (tenant,
 *                                template), so a retried instantiate reads the
 *                                first result instead of creating a second
 *                                department.
 */
import { pgSchema, uuid, varchar, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const deptTemplatePgSchema = pgSchema("dept_template");

export const departmentTemplates = deptTemplatePgSchema.table("department_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  sourceDepartmentId: uuid("source_department_id"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  droppedRefs: jsonb("dropped_refs").$type<string[]>().notNull().default([]),
  /** active | archived */
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  codeUnique: uniqueIndex("uq_dept_templates_code").on(t.tenantId, t.code),
}));

export const departmentInstantiations = deptTemplatePgSchema.table("department_instantiations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  templateId: uuid("template_id").notNull(),
  templateVersion: integer("template_version").notNull(),
  departmentCode: varchar("department_code", { length: 64 }).notNull(),
  departmentName: varchar("department_name", { length: 200 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  idemUnique: uniqueIndex("uq_dept_inst_idempotency").on(t.tenantId, t.templateId, t.idempotencyKey),
  codeUnique: uniqueIndex("uq_dept_inst_code").on(t.tenantId, t.departmentCode),
}));

export type DepartmentTemplateRow = typeof departmentTemplates.$inferSelect;
export type DepartmentTemplateInsert = typeof departmentTemplates.$inferInsert;
export type DepartmentInstantiationRow = typeof departmentInstantiations.$inferSelect;
export type DepartmentInstantiationInsert = typeof departmentInstantiations.$inferInsert;

export const schema = { departmentTemplates, departmentInstantiations };
