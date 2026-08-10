/**
 * booking module — Community hall / facility booking for establishments (BRD 5.22 HALL-001…005).
 *
 * Tables:
 *   estab_facilities_catalog  — bookable facilities inventory
 *   estab_bookings            — booking requests and lifecycle
 *   estab_booking_calendar    — slot-level availability / blocking
 *
 * PG Schema: `booking`
 * All money as bigint paise. Optimistic locking via `version`.
 */
import {
  pgSchema, uuid, text, varchar, integer, bigint, char, boolean, date, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const bookingSchema = pgSchema("booking");

export const estabFacilitiesCatalog = bookingSchema.table("estab_facilities_catalog", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  facilityName:      text("facility_name").notNull(),
  facilityType:      varchar("facility_type", { length: 32 }).notNull(),
  address:           jsonb("address"),
  ward:              varchar("ward", { length: 64 }),
  capacity:          integer("capacity"),
  amenities:         jsonb("amenities"),
  photos:            jsonb("photos"),
  ratePerHourMinor:  bigint("rate_per_hour_minor", { mode: "bigint" }),
  ratePerDayMinor:   bigint("rate_per_day_minor", { mode: "bigint" }),
  currency:          char("currency", { length: 3 }).notNull().default("INR"),
  securityDepositMinor: bigint("security_deposit_minor", { mode: "bigint" }),
  status:            varchar("status", { length: 24 }).notNull().default("active"),
  operatingHours:    jsonb("operating_hours"),
  closedDays:        jsonb("closed_days"),
  rules:             text("rules"),
  contactPerson:     text("contact_person"),
  contactPhone:      varchar("contact_phone", { length: 15 }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export const estabBookings = bookingSchema.table("estab_bookings", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  bookingNumber:     text("booking_number").notNull(),
  facilityId:        uuid("facility_id").notNull(),
  applicantName:     text("applicant_name").notNull(),
  applicantPhone:    varchar("applicant_phone", { length: 15 }).notNull(),
  applicantEmail:    varchar("applicant_email", { length: 255 }),
  purpose:           text("purpose"),
  eventType:         varchar("event_type", { length: 24 }).notNull().default("other"),
  eventDate:         date("event_date").notNull(),
  startTime:         varchar("start_time", { length: 8 }).notNull(),
  endTime:           varchar("end_time", { length: 8 }).notNull(),
  durationHours:     integer("duration_hours"),
  guestCount:        integer("guest_count"),
  requirements:      jsonb("requirements"),
  status:            varchar("status", { length: 24 }).notNull().default("draft"),
  approvedBy:        uuid("approved_by"),
  approvedAt:        timestamp("approved_at", { withTimezone: true }),
  amountMinor:       bigint("amount_minor", { mode: "bigint" }),
  securityDepositMinor: bigint("security_deposit_minor", { mode: "bigint" }),
  totalMinor:        bigint("total_minor", { mode: "bigint" }),
  currency:          char("currency", { length: 3 }).notNull().default("INR"),
  paymentRef:        text("payment_ref"),
  paidAt:            timestamp("paid_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  cancelledAt:       timestamp("cancelled_at", { withTimezone: true }),
  refundAmountMinor: bigint("refund_amount_minor", { mode: "bigint" }),
  refundRef:         text("refund_ref"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export const estabBookingCalendar = bookingSchema.table("estab_booking_calendar", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  facilityId:  uuid("facility_id").notNull(),
  bookingDate: date("booking_date").notNull(),
  slotStart:   varchar("slot_start", { length: 8 }).notNull(),
  slotEnd:     varchar("slot_end", { length: 8 }).notNull(),
  bookingId:   uuid("booking_id"),
  isBlocked:   boolean("is_blocked").notNull().default(false),
  blockReason: text("block_reason"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type FacilityCatalogRow    = typeof estabFacilitiesCatalog.$inferSelect;
export type FacilityCatalogInsert = typeof estabFacilitiesCatalog.$inferInsert;
export type BookingRow            = typeof estabBookings.$inferSelect;
export type BookingInsert         = typeof estabBookings.$inferInsert;
export type BookingCalendarRow    = typeof estabBookingCalendar.$inferSelect;
export type BookingCalendarInsert = typeof estabBookingCalendar.$inferInsert;

export const schema = { estabFacilitiesCatalog, estabBookings, estabBookingCalendar };
