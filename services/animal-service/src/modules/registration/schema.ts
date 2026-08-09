import { pgSchema, uuid, varchar, integer, bigint, date, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const animalSchema = pgSchema("animal");

export const animalRegistrations = animalSchema.table("animal_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  registrationNumber: varchar("registration_number", { length: 64 }).notNull().unique(),
  ownerName: text("owner_name").notNull(),
  ownerPhone: varchar("owner_phone", { length: 20 }).notNull(),
  ownerAddress: jsonb("owner_address").$type<{ line1: string; line2?: string; city: string; pin: string }>().notNull(),
  animalType: varchar("animal_type", { length: 32 }).notNull(),
  breed: varchar("breed", { length: 64 }),
  name: text("name"),
  color: text("color"),
  age: integer("age"),
  sex: varchar("sex", { length: 8 }),
  microchipId: text("microchip_id"),
  vaccinationRecords: jsonb("vaccination_records").$type<Array<{ vaccine: string; date: string; nextDue?: string; vet?: string }>>(),
  photo: text("photo"),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  validUntil: date("valid_until"),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RegistrationRow = typeof animalRegistrations.$inferSelect;
export type RegistrationInsert = typeof animalRegistrations.$inferInsert;

export const schema = { animalRegistrations };
