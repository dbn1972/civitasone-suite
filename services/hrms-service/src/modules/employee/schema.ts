import {
  pgSchema, uuid, text, integer, bigint, char, varchar, boolean, date, timestamp,
} from "drizzle-orm/pg-core";

export const employeeSchema = pgSchema("employee");

export const hrmsDepartments = employeeSchema.table("hrms_departments", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  code:       text("code").notNull(),
  name:       text("name").notNull(),
  parentId:   uuid("parent_id"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const hrmsDesignations = employeeSchema.table("hrms_designations", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  code:       text("code").notNull(),
  name:       text("name").notNull(),
  level:      integer("level").notNull().default(0),
  payGrade:   text("pay_grade"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const hrmsEmployees = employeeSchema.table("hrms_employees", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  employeeNo:       text("employee_no").notNull(),
  fullName:         text("full_name").notNull(),
  departmentId:     uuid("department_id").notNull(),
  designationId:    uuid("designation_id").notNull(),
  dateOfJoining:    date("date_of_joining").notNull(),
  dateOfBirth:      date("date_of_birth"),
  gender:           varchar("gender", { length: 16 }),
  pan:              varchar("pan", { length: 16 }),
  uanNumber:        varchar("uan_number", { length: 12 }),
  hraCityClass:     varchar("hra_city_class", { length: 1 }).notNull().default("X"),
  taxRegime:        varchar("tax_regime", { length: 4 }).notNull().default("new"),
  aadhaarRef:       text("aadhaar_ref"),
  mobile:           varchar("mobile", { length: 20 }),
  email:            text("email"),
  bankAccountNo:    text("bank_account_no"),
  bankIfsc:         varchar("bank_ifsc", { length: 16 }),
  employeeType:     varchar("employee_type", { length: 24 }).notNull().default("permanent"),
  status:           varchar("status", { length: 24 }).notNull().default("probation"),
  confirmationDate: date("confirmation_date"),
  basicMinor:       bigint("basic_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  payStructureId:   uuid("pay_structure_id"),
  pensionScheme:    varchar("pension_scheme", { length: 8 }).notNull().default("NPS"),
  managerId:        uuid("manager_id"),
  userRef:          text("user_ref"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const hrmsEmployeeDocs = employeeSchema.table("hrms_employee_docs", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  employeeId:   uuid("employee_id").notNull(),
  docType:      varchar("doc_type", { length: 64 }).notNull(),
  docRef:       text("doc_ref").notNull(),
  storageKey:   text("storage_key"),
  verified:     boolean("verified").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type EmployeeRow = typeof hrmsEmployees.$inferSelect;
export type EmployeeInsert = typeof hrmsEmployees.$inferInsert;
export type DeptRow = typeof hrmsDepartments.$inferSelect;

export const schema = { hrmsDepartments, hrmsDesignations, hrmsEmployees, hrmsEmployeeDocs };
