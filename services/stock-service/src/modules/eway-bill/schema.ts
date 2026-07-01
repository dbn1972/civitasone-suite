import {
  pgSchema, uuid, text, bigint, integer, date, timestamp, varchar,
} from "drizzle-orm/pg-core";

export const ewayBillSchema = pgSchema("eway_bill");

export const ewayBills = ewayBillSchema.table("eway_bills", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  ewbNo:           text("ewb_no"),
  invoiceId:       uuid("invoice_id"),
  dispatchId:      uuid("dispatch_id"),
  supplyType:      varchar("supply_type", { length: 16 }).notNull(),
  subSupplyType:   varchar("sub_supply_type", { length: 24 }).notNull(),
  docType:         varchar("doc_type", { length: 16 }).notNull(),
  docNo:           text("doc_no").notNull(),
  docDate:         date("doc_date").notNull(),
  fromGstin:       text("from_gstin").notNull(),
  fromName:        text("from_name").notNull(),
  fromAddr:        text("from_addr").notNull(),
  fromPin:         text("from_pin").notNull(),
  fromStateCode:   text("from_state_code").notNull(),
  toGstin:         text("to_gstin"),
  toName:          text("to_name").notNull(),
  toAddr:          text("to_addr").notNull(),
  toPin:           text("to_pin").notNull(),
  toStateCode:     text("to_state_code").notNull(),
  totalValueMinor: bigint("total_value_minor", { mode: "bigint" }).notNull(),
  hsnCode:         text("hsn_code").notNull(),
  transportMode:   varchar("transport_mode", { length: 8 }),
  vehicleNo:       text("vehicle_no"),
  transporterId:   text("transporter_id"),
  validUntil:      timestamp("valid_until", { withTimezone: true }),
  status:          varchar("status", { length: 16 }).notNull().default("pending"),
  errorMessage:    text("error_message"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type EwayBillRow    = typeof ewayBills.$inferSelect;
export type EwayBillInsert = typeof ewayBills.$inferInsert;

export const schema = { ewayBills };
