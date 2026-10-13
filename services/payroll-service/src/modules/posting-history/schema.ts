/**
 * ST-M01-11 — dated posting / DDO history (SmartTransfer OS).
 *
 * Drizzle model for payroll.posting_history (migration 0087). Kept in sync with
 * the migration and wired into shared/db.ts's SCHEMA map. Stores ONLY the
 * posting FACT the `hrms.posting.changed` event carries (office move, station,
 * state, HRA city class, optional DDO, effective date, order number). No pay
 * computation / TA-DA / split / HRA-class derivation (PROPOSED D-ST-13/14).
 */
import { pgSchema, uuid, varchar, date, timestamp, unique } from "drizzle-orm/pg-core";

const payrollSchema = pgSchema("payroll");

export const postingHistory = payrollSchema.table(
  "posting_history",
  {
    id:            uuid("id").primaryKey().defaultRandom(),
    tenantId:      uuid("tenant_id").notNull(),
    employeeId:    uuid("employee_id").notNull(),
    fromOfficeId:  uuid("from_office_id").notNull(),
    toOfficeId:    uuid("to_office_id").notNull(),
    station:       varchar("station", { length: 200 }).notNull(),
    state:         varchar("state", { length: 200 }).notNull(),
    cityClass:     varchar("city_class", { length: 8 }).notNull(),
    // Nullable: no DDO source in Workforce Core today (D-ST-14 PROPOSED).
    ddo:           uuid("ddo"),
    effectiveFrom: date("effective_from").notNull(),
    orderNumber:   varchar("order_number", { length: 200 }).notNull(),
    // Idempotency key: the originating posting event id.
    eventId:       uuid("event_id").notNull(),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy:     uuid("created_by").notNull(),
  },
  (t) => ({
    uxEvent: unique("ux_posting_history_event").on(t.tenantId, t.eventId),
  }),
);

export type PostingHistoryRow = typeof postingHistory.$inferSelect;
export type PostingHistoryInsert = typeof postingHistory.$inferInsert;

export const schema = { postingHistory };
