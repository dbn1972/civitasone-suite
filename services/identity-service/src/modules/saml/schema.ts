import { pgSchema, uuid, varchar, boolean, text, timestamp, integer } from "drizzle-orm/pg-core";

export const samlSchema = pgSchema("saml");

export const samlTenantConfig = samlSchema.table("tenant_config", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull().unique(),
  entityId:        varchar("entity_id", { length: 512 }).notNull(),
  acsUrl:          varchar("acs_url", { length: 2048 }).notNull(),
  idpMetadataUrl:  varchar("idp_metadata_url", { length: 2048 }),
  idpMetadataXml:  text("idp_metadata_xml"),
  signRequests:    boolean("sign_requests").notNull().default(true),
  nameIdFormat:    varchar("name_id_format", { length: 16 }).notNull().default("email"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type SamlTenantConfigRow    = typeof samlTenantConfig.$inferSelect;
export type SamlTenantConfigInsert = typeof samlTenantConfig.$inferInsert;

export const samlModuleSchema = { samlTenantConfig };
