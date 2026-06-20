import { pgSchema, uuid, text, integer, bigint, char, boolean, varchar, timestamp } from "drizzle-orm/pg-core";

export const auctionSchema = pgSchema("auction");

export const procurementAuctions = auctionSchema.table("procurement_auctions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  auctionNo:     text("auction_no").notNull(),
  indentRef:     text("indent_ref").notNull(),
  title:         text("title").notNull(),
  reserveMinor:  bigint("reserve_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  startAt:       timestamp("start_at", { withTimezone: true }).notNull(),
  endAt:         timestamp("end_at", { withTimezone: true }).notNull(),
  status:        varchar("status", { length: 24 }).notNull().default("draft"),
  winningBidId:  uuid("winning_bid_id"),
  msePreference: boolean("mse_preference").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const procurementBids = auctionSchema.table("procurement_bids", {
  id:             uuid("id").primaryKey().defaultRandom(),
  auctionId:      uuid("auction_id").notNull(),
  tenantId:       uuid("tenant_id").notNull(),
  vendorId:       uuid("vendor_id").notNull(),
  bidMinor:       bigint("bid_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  isMse:          boolean("is_mse").notNull().default(false),
  effectiveMinor: bigint("effective_minor", { mode: "bigint" }).notNull().default(0n),
  rank:           integer("rank"),
  bidAt:          timestamp("bid_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type AuctionRow    = typeof procurementAuctions.$inferSelect;
export type AuctionInsert = typeof procurementAuctions.$inferInsert;
export type BidRow    = typeof procurementBids.$inferSelect;
export type BidInsert = typeof procurementBids.$inferInsert;

export const schema = { procurementAuctions, procurementBids };
