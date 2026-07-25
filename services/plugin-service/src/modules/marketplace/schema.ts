import { pgSchema, uuid, varchar, text, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
const pluginSchema = pgSchema("plugin");
export const marketplaceListings = pluginSchema.table("marketplace_listings", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        varchar("name", { length: 128 }).notNull(),
  version:     varchar("version", { length: 32 }).notNull(),
  publisher:   varchar("publisher", { length: 128 }).notNull(),
  description: text("description"),
  category:    varchar("category", { length: 64 }),
  rating:      numeric("rating", { precision: 2, scale: 1 }),
  installs:    integer("installs").notNull().default(0),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const marketplaceSchema = { marketplaceListings };
