/**
 * gateway-service DB — TenantRouter / createTenantDb fleet pattern (F6).
 *
 * Catalogue is the only persistent domain store the gateway owns
 * (DB civitas_gateway, role gateway_svc, NOBYPASSRLS + FORCE RLS).
 * createTenantDb is called at module load; catalogue routes are only mounted
 * when DATABASE_URL is present (see app.ts) so the proxy still boots without a DB.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as catalogueModule } from "../modules/catalogue/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...catalogueModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({
  schema: SCHEMA,
});

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
