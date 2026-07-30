import {
  pgSchema, uuid, text, integer, bigint, char, varchar, boolean, date, timestamp,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const employeeSchema = pgSchema("employee");

export const hrmsDepartments = employeeSchema.table("hrms_departments", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  code:       text("code").notNull(),
  name:       text("name").notNull(),
  parentId:   uuid("parent_id"),
  type:       text("type"),               // admin level (edition-specific vocabulary)
  level:      integer("level"),           // numeric depth (0=root)
  govtTier:   text("govt_tier"),          // 'central' | 'state' | null
  locationId: uuid("location_id"),        // cross-service ref to location-service
  headEmployeeId: uuid("head_employee_id"), // head of this unit
  isActive:   boolean("is_active").notNull().default(true),
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
  station:          varchar("station", { length: 128 }),
  dateOfJoining:    date("date_of_joining").notNull(),
  dateOfBirth:      date("date_of_birth"),
  gender:           varchar("gender", { length: 16 }),
  pan:              encryptedText("pan"),
  uanNumber:        varchar("uan_number", { length: 12 }),
  hraCityClass:     varchar("hra_city_class", { length: 1 }).notNull().default("X"),
  taxRegime:        varchar("tax_regime", { length: 4 }).notNull().default("new"),
  aadhaarRef:       encryptedText("aadhaar_ref"),
  mobile:           encryptedText("mobile"),
  email:            text("email"),
  bankAccountNo:    encryptedText("bank_account_no"),
  bankIfsc:         encryptedText("bank_ifsc"),
  employeeType:     varchar("employee_type", { length: 24 }).notNull().default("permanent"),
  status:           varchar("status", { length: 24 }).notNull().default("probation"),
  confirmationDate: date("confirmation_date"),
  basicMinor:       bigint("basic_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  payStructureId:   uuid("pay_structure_id"),
  pensionScheme:    varchar("pension_scheme", { length: 8 }).notNull().default("NPS"),
  // Statutory identifiers (DIC): EPFO UAN is above; ESIC Insured-Person no. + NPS PRAN.
  esicIpNumber:     varchar("esic_ip_number", { length: 17 }),
  pran:             varchar("pran", { length: 12 }),
  // Engagement-type-specific identifiers: consultant GSTIN/SAC (194J+GST),
  // third-party agency deployment ref (CLRA), apprentice NAPS/NATS registration.
  gstin:            varchar("gstin", { length: 15 }),
  sacCode:          varchar("sac_code", { length: 6 }),
  agencyRef:        varchar("agency_ref", { length: 64 }),
  napsId:           varchar("naps_id", { length: 24 }),
  managerId:        uuid("manager_id"),
  userRef:          text("user_ref"),
  // ERP org-structure refs (cross-service)
  legalEntityId:    uuid("legal_entity_id"),     // finance org.legal_entities
  costCenterId:     uuid("cost_center_id"),      // finance org.cost_centers
  locationId:       uuid("location_id"),         // location-service
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

// DEF-EM-003: nominee / dependant / next-of-kin table (T04).
export const hrmsEmployeeNominees = employeeSchema.table("hrms_employee_nominees", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  employeeId:   uuid("employee_id").notNull(),
  name:         varchar("name", { length: 200 }).notNull(),
  relationship: varchar("relationship", { length: 64 }).notNull(),
  dateOfBirth:  date("date_of_birth"),
  sharePercent: integer("share_percent"),
  contactPhone: varchar("contact_phone", { length: 20 }),
  purpose:      varchar("purpose", { length: 32 }).notNull().default("general"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});
export type NomineeRow = typeof hrmsEmployeeNominees.$inferSelect;
export type NomineeInsert = typeof hrmsEmployeeNominees.$inferInsert;

// DEF-EM-002: multi-address model with history (T05).
export const hrmsEmployeeAddresses = employeeSchema.table("hrms_employee_addresses", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  employeeId:   uuid("employee_id").notNull(),
  addressType:  varchar("address_type", { length: 16 }).notNull(),
  line1:        text("line1").notNull(),
  line2:        text("line2"),
  city:         varchar("city", { length: 100 }),
  state:        varchar("state", { length: 100 }),
  pincode:      varchar("pincode", { length: 10 }),
  country:      varchar("country", { length: 64 }).notNull().default("IN"),
  isCurrent:    boolean("is_current").notNull().default(true),
  effectiveFrom: date("effective_from"),
  effectiveTo:  date("effective_to"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  version:      integer("version").notNull().default(1),
});
export type AddressRow = typeof hrmsEmployeeAddresses.$inferSelect;
export type AddressInsert = typeof hrmsEmployeeAddresses.$inferInsert;

export const schema = { hrmsDepartments, hrmsDesignations, hrmsEmployees, hrmsEmployeeDocs, hrmsEmployeeNominees, hrmsEmployeeAddresses };
