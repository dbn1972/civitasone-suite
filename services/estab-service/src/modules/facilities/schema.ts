import {
  pgSchema, uuid, text, varchar, integer, bigint, char, boolean, timestamp,
} from "drizzle-orm/pg-core";

export const facilitiesSchema = pgSchema("facilities");

export const estabGuesthouses = facilitiesSchema.table("estab_guesthouses", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      text("name").notNull(),
  location:  text("location"),
  contact:   text("contact"),
  status:    varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const estabRooms = facilitiesSchema.table("estab_rooms", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  guesthouseId: uuid("guesthouse_id").notNull(),
  roomNo:       text("room_no").notNull(),
  type:         varchar("type", { length: 32 }).notNull().default("standard"),
  capacity:     integer("capacity").notNull().default(1),
  status:       varchar("status", { length: 24 }).notNull().default("available"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const estabRoomBookings = facilitiesSchema.table("estab_room_bookings", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  roomId:       uuid("room_id").notNull(),
  guestName:    text("guest_name").notNull(),
  guestRef:     uuid("guest_ref"),
  checkIn:      timestamp("check_in", { withTimezone: true }).notNull(),
  checkOut:     timestamp("check_out", { withTimezone: true }).notNull(),
  sponsorDept:  text("sponsor_dept"),
  chargesMinor: bigint("charges_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  status:       varchar("status", { length: 24 }).notNull().default("booked"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const estabLibraryBooks = facilitiesSchema.table("estab_library_books", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  accessionNo:      text("accession_no").notNull(),
  title:            text("title").notNull(),
  author:           text("author"),
  isbn:             text("isbn"),
  category:         text("category"),
  copiesTotal:      integer("copies_total").notNull().default(1),
  copiesAvailable:  integer("copies_available").notNull().default(1),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const estabIssues = facilitiesSchema.table("estab_issues", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  bookId:      uuid("book_id").notNull(),
  employeeRef: uuid("employee_ref").notNull(),
  issuedAt:    timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt:       timestamp("due_at", { withTimezone: true }).notNull(),
  returnedAt:  timestamp("returned_at", { withTimezone: true }),
  status:      varchar("status", { length: 24 }).notNull().default("issued"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type GuesthouseRow     = typeof estabGuesthouses.$inferSelect;
export type GuesthouseInsert  = typeof estabGuesthouses.$inferInsert;
export type RoomBookingRow    = typeof estabRoomBookings.$inferSelect;
export type RoomBookingInsert = typeof estabRoomBookings.$inferInsert;
export type LibraryBookRow    = typeof estabLibraryBooks.$inferSelect;
export type LibraryBookInsert = typeof estabLibraryBooks.$inferInsert;
export type IssueInsert       = typeof estabIssues.$inferInsert;

export const schema = { estabGuesthouses, estabRooms, estabRoomBookings, estabLibraryBooks, estabIssues };
