import {
  pgSchema, uuid, text, varchar, integer, boolean, timestamp, date,
} from "drizzle-orm/pg-core";

export const committeeSchema = pgSchema("committee");

export const estabCommittees = committeeSchema.table("estab_committees", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      text("name").notNull(),
  purpose:   text("purpose"),
  chairRef:  uuid("chair_ref").notNull(),
  status:    varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const estabMeetings = committeeSchema.table("estab_meetings", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  committeeId: uuid("committee_id").notNull(),
  title:       text("title").notNull(),
  whenAt:      timestamp("when_at", { withTimezone: true }).notNull(),
  venue:       text("venue"),
  minutesUrl:  text("minutes_url"),
  status:      varchar("status", { length: 24 }).notNull().default("scheduled"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const estabResolutions = committeeSchema.table("estab_resolutions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  meetingId:   uuid("meeting_id").notNull(),
  seq:         integer("seq").notNull(),
  body:        text("body").notNull(),
  actionOwner: uuid("action_owner"),
  dueDate:     date("due_date"),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const estabAttendees = committeeSchema.table("estab_attendees", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  meetingId: uuid("meeting_id").notNull(),
  memberRef: uuid("member_ref").notNull(),
  role:      varchar("role", { length: 32 }).notNull().default("member"),
  attended:  boolean("attended").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type CommitteeRow    = typeof estabCommittees.$inferSelect;
export type CommitteeInsert = typeof estabCommittees.$inferInsert;
export type MeetingRow      = typeof estabMeetings.$inferSelect;
export type MeetingInsert   = typeof estabMeetings.$inferInsert;
export type ResolutionRow   = typeof estabResolutions.$inferSelect;
export type ResolutionInsert = typeof estabResolutions.$inferInsert;
export type AttendeeRow     = typeof estabAttendees.$inferSelect;
export type AttendeeInsert  = typeof estabAttendees.$inferInsert;

export const schema = { estabCommittees, estabMeetings, estabResolutions, estabAttendees };
