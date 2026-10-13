import { pgSchema, uuid, varchar, text, integer, smallint, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
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
  ratingSum:   integer("rating_sum").notNull().default(0),
  ratingCount: integer("rating_count").notNull().default(0),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-tenant review (FORCE RLS). One per reviewer per listing; messageId = the command that last wrote it. */
export const marketplaceReviews = pluginSchema.table("marketplace_reviews", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  listingId:  uuid("listing_id").notNull(),
  reviewerId: uuid("reviewer_id").notNull(),
  rating:     smallint("rating").notNull(),
  comment:    text("comment"),
  messageId:  uuid("message_id").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const marketplaceSchema = { marketplaceListings, marketplaceReviews };
