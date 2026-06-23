import { pgSchema, uuid, text, varchar, integer, timestamp, jsonb, bigserial, bigint } from "drizzle-orm/pg-core";

export const devicesSchema = pgSchema("devices");

export const registeredDevices = devicesSchema.table("registered_devices", {
  id:          uuid("id").primaryKey(),
  tenantId:    uuid("tenant_id").notNull(),
  userId:      uuid("user_id").notNull(),
  platform:    varchar("platform", { length: 16 }).notNull(),
  label:       text("label").notNull(),
  fingerprint: text("fingerprint").notNull(),
  trustToken:  text("trust_token").notNull(),
  trustLevel:  varchar("trust_level", { length: 24 }).notNull().default("recognized"),
  lastSeenAt:  timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const syncSchema = pgSchema("sync");

export const mailboxCursors = syncSchema.table("mailbox_cursors", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  userId:       uuid("user_id").notNull(),
  deviceId:     uuid("device_id").notNull(),
  mailbox:      varchar("mailbox", { length: 32 }).notNull(),
  cursorValue:  text("cursor_value").notNull().default("0"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const entityChangelog = syncSchema.table("entity_changelog", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  mailbox:   varchar("mailbox", { length: 32 }).notNull(),
  entityId:  uuid("entity_id").notNull(),
  operation: varchar("operation", { length: 16 }).notNull(),
  payload:   jsonb("payload").$type<Record<string, unknown>>(),
  etag:      text("etag").notNull(),
  // 03-T7: optional row owner for user-private mailboxes (e.g. notifications).
  ownerUserId: uuid("owner_user_id"),
  seq:       bigserial("seq", { mode: "bigint" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// SYN-1b: idempotency ledger for client mutations (see migration 0007).
export const processedMutations = syncSchema.table("processed_mutations", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  deviceId:         uuid("device_id").notNull(),
  clientMutationId: uuid("client_mutation_id").notNull(),
  mailbox:          varchar("mailbox", { length: 32 }).notNull(),
  entityId:         uuid("entity_id").notNull(),
  status:           varchar("status", { length: 16 }).notNull(),
  resultEtag:       text("result_etag"),
  resultSeq:        bigint("result_seq", { mode: "bigint" }),
  reason:           text("reason"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { registeredDevices, mailboxCursors, entityChangelog, processedMutations };
