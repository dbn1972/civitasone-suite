import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp, boolean, jsonb,
} from "drizzle-orm/pg-core";

export const enterpriseSchema = pgSchema("enterprise");

export const projectAuc = enterpriseSchema.table("project_auc", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  projectCode:      text("project_code").notNull(),
  name:             text("name").notNull(),
  wbsRef:           text("wbs_ref"),
  accumulatedMinor: bigint("accumulated_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  status:           varchar("status", { length: 24 }).notNull().default("under_construction"),
  assetId:          uuid("asset_id"),
  // GAP-ASSETS-PROJECTS-09 (migration 0037): two-step capitalisation.
  capitalizationDate: date("capitalization_date"),
  capRequestedBy:   uuid("cap_requested_by"),
  capRequestedAt:   timestamp("cap_requested_at", { withTimezone: true }),
  capReason:        text("cap_reason"),
  capDecidedBy:     uuid("cap_decided_by"),
  capDecidedAt:     timestamp("cap_decided_at", { withTimezone: true }),
  capRejectReason:  text("cap_reject_reason"),
  // Finance-side state of the capitalisation journal (migration 0037): none | pending | posted | failed.
  glPostStatus:     varchar("gl_post_status", { length: 12 }).notNull().default("none"),
  glJournalId:      uuid("gl_journal_id"),
  glPostError:      text("gl_post_error"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const assetLeases = enterpriseSchema.table("asset_leases", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  leaseNo:         text("lease_no").notNull(),
  lessorName:      text("lessor_name").notNull(),
  rouCostMinor:    bigint("rou_cost_minor", { mode: "bigint" }).notNull().default(0n),
  liabilityMinor:  bigint("liability_minor", { mode: "bigint" }).notNull().default(0n),
  leaseStart:      date("lease_start").notNull(),
  leaseEnd:        date("lease_end").notNull(),
  assetId:         uuid("asset_id"),
  status:          varchar("status", { length: 24 }).notNull().default("active"),
  // GAP-ASSETS-LEASES-07 (migration 0038): discounting inputs; null on legacy / manual-liability leases.
  ibrBps:          integer("ibr_bps"),
  paymentMinor:    bigint("payment_minor", { mode: "bigint" }),
  paymentFrequency: varchar("payment_frequency", { length: 12 }),
  schedulePeriods: integer("schedule_periods"),
  glPostStatus:    varchar("gl_post_status", { length: 12 }).notNull().default("none"),
  glJournalId:     uuid("gl_journal_id"),
  glPostError:     text("gl_post_error"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const assetImpairments = enterpriseSchema.table("asset_impairments", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  assetId:         uuid("asset_id").notNull(),
  eventType:       varchar("event_type", { length: 16 }).notNull(),
  amountMinor:     bigint("amount_minor", { mode: "bigint" }).notNull(),
  bookValueBefore: bigint("book_value_before", { mode: "bigint" }).notNull(),
  bookValueAfter:  bigint("book_value_after", { mode: "bigint" }).notNull(),
  reason:          text("reason"),
  eventDate:       date("event_date").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

export const functionalLocations = enterpriseSchema.table("functional_locations", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  code:      text("code").notNull(),
  name:      text("name").notNull(),
  parentId:  uuid("parent_id"),
  orgUnit:   varchar("org_unit", { length: 64 }),
  // GAP-ASSETS-LOCATIONS-02 (migration 0036): deactivate instead of delete (assets may reference the row).
  isActive:      boolean("is_active").notNull().default(true),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  deactivatedBy: uuid("deactivated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

/** GAP-ASSETS-SCAN-06 (migration 0036): one row per barcode scan -- physical-verification evidence. */
export const assetScanLog = enterpriseSchema.table("asset_scan_log", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  barcode:   text("barcode").notNull(),
  assetId:   uuid("asset_id"),
  found:     boolean("found").notNull(),
  scannedBy: uuid("scanned_by").notNull(),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
});

/** GAP-ASSETS-PROJECTS-09 (migration 0037): per-tenant asset policy. Absent row => defaults (maker-checker ON). */
export const assetSettings = enterpriseSchema.table("asset_settings", {
  tenantId:              uuid("tenant_id").primaryKey(),
  capitalizeMakerChecker: boolean("capitalize_maker_checker").notNull().default(true),
  // Second approver for GL head changes (migration 0039). Default ON.
  glMakerChecker:        boolean("gl_maker_checker").notNull().default(true),
  cwipAccountCode:       varchar("cwip_account_code", { length: 16 }),
  fixedAssetAccountCode: varchar("fixed_asset_account_code", { length: 16 }),
  impairmentExpenseAccountCode: varchar("impairment_expense_account_code", { length: 16 }),
  revaluationReserveAccountCode: varchar("revaluation_reserve_account_code", { length: 16 }),
  // fp-assets-02 (migration 0039): the heads the acquisition / maintenance journals used to default from env.
  grnClearingAccountCode: varchar("grn_clearing_account_code", { length: 16 }),
  acquisitionOffsetAccountCode: varchar("acquisition_offset_account_code", { length: 16 }),
  maintenanceExpenseAccountCode: varchar("maintenance_expense_account_code", { length: 16 }),
  apControlAccountCode:  varchar("ap_control_account_code", { length: 16 }),
  rouAccountCode:        varchar("rou_account_code", { length: 16 }),
  leaseLiabilityAccountCode: varchar("lease_liability_account_code", { length: 16 }),
  leaseOffsetAccountCode: varchar("lease_offset_account_code", { length: 16 }),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:             uuid("updated_by").notNull(),
  version:               integer("version").notNull().default(1),
});

/** Two-person requests for settings that weaken a control (migration 0037). */
export const assetSettingRequests = enterpriseSchema.table("asset_setting_requests", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  kind:           varchar("kind", { length: 32 }).notNull().default("maker_checker_off"),
  status:         varchar("status", { length: 12 }).notNull().default("pending"),
  reason:         text("reason").notNull(),
  requestedBy:    uuid("requested_by").notNull(),
  requestedAt:    timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy:      uuid("decided_by"),
  decidedAt:      timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  // The change the request carries (kind gl_heads_change: the head patch applied on approval).
  payload:        jsonb("payload").$type<Record<string, unknown>>(),
});

/** GAP-ASSETS-LEASES-07 (migration 0038): amortisation schedule of a discounted lease liability. */
export const leaseScheduleRows = enterpriseSchema.table("lease_schedule_rows", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  leaseId:        uuid("lease_id").notNull(),
  seq:            integer("seq").notNull(),
  dueDate:        date("due_date").notNull(),
  openingMinor:   bigint("opening_minor", { mode: "bigint" }).notNull(),
  interestMinor:  bigint("interest_minor", { mode: "bigint" }).notNull(),
  paymentMinor:   bigint("payment_minor", { mode: "bigint" }).notNull(),
  principalMinor: bigint("principal_minor", { mode: "bigint" }).notNull(),
  closingMinor:   bigint("closing_minor", { mode: "bigint" }).notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spareParts = enterpriseSchema.table("spare_parts", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  workOrderId:  uuid("work_order_id").notNull(),
  partCode:     text("part_code").notNull(),
  description:  text("description"),
  qty:          integer("qty").notNull().default(1),
  costMinor:    bigint("cost_minor", { mode: "bigint" }).notNull().default(0n),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
});

export const schema = { projectAuc, assetLeases, assetImpairments, functionalLocations, spareParts, assetScanLog, assetSettings, assetSettingRequests, leaseScheduleRows };
