import { pgSchema, uuid, text, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const procurementSchema = pgSchema("procurement");

export const vendorBlacklist = procurementSchema.table("vendor_blacklist", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  vendorId:         uuid("vendor_id").notNull(),
  scope:            varchar("scope", { length: 16 }).notNull().default("tenant"), // tenant | central (CVC government-wide)
  pan:              text("pan"),                                                  // firm PAN for federated (central) debarment matching
  reason:           text("reason").notNull(),
  blacklistedAt:    timestamp("blacklisted_at", { withTimezone: true }).notNull().defaultNow(),
  blacklistedBy:    uuid("blacklisted_by").notNull(),
  blacklistedFrom:  date("blacklisted_from"),
  blacklistedUntil: date("blacklisted_until"),
  orderRef:         text("order_ref"),
  reinstatedAt:     timestamp("reinstated_at", { withTimezone: true }),
  status:           varchar("status", { length: 16 }).notNull().default("active"),
  createdBy:        uuid("created_by"),
});

export type VendorBlacklistRow    = typeof vendorBlacklist.$inferSelect;
export type VendorBlacklistInsert = typeof vendorBlacklist.$inferInsert;

export const schema = { vendorBlacklist };
