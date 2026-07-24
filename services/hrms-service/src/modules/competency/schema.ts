import {
  pgSchema, uuid, text, integer, varchar, timestamp,
} from "drizzle-orm/pg-core";

export const competencySchema = pgSchema("competency");

export const frameworks = competencySchema.table("frameworks", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  name:        text("name").notNull(),
  description: text("description"),
  status:      varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

export const competencies = competencySchema.table("competencies", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  frameworkId:    uuid("framework_id").notNull(),
  code:           varchar("code", { length: 48 }).notNull(),
  name:           text("name").notNull(),
  description:    text("description"),
  category:       varchar("category", { length: 64 }).notNull().default("general"),
  maxLevel:       integer("max_level").notNull().default(5),
  certifiedLevel: integer("certified_level").notNull().default(3),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roleRequirements = competencySchema.table("role_requirements", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  roleCode:      varchar("role_code", { length: 64 }).notNull(),
  competencyId:  uuid("competency_id").notNull(),
  requiredLevel: integer("required_level").notNull().default(1),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeeCompetencies = competencySchema.table("employee_competencies", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  employeeId:   uuid("employee_id").notNull(),
  competencyId: uuid("competency_id").notNull(),
  currentLevel: integer("current_level").notNull().default(0),
  source:       varchar("source", { length: 16 }).notNull().default("manual"),
  evidenceRef:  text("evidence_ref"),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CompetencyRow = typeof competencies.$inferSelect;
export type RoleRequirementRow = typeof roleRequirements.$inferSelect;
export type EmployeeCompetencyRow = typeof employeeCompetencies.$inferSelect;

export const schema = {
  frameworks, competencies, roleRequirements, employeeCompetencies,
};
