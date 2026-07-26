/**
 * CAP-052 — gateway-service catalogue DB (DB civitas_gateway, role gateway_svc).
 *
 * The gateway is otherwise stateless; the catalogue is the one persistent store
 * it owns. createTenantDb is called lazily so the gateway still boots with no
 * DATABASE_URL configured (the catalogue routes are only mounted when a DB is
 * present — see app.ts). gateway_svc is NOBYPASSRLS + the tables are FORCE RLS,
 * so every read/write must run inside withTenantScope() to set app.tenant_id.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as catalogueModule } from "./schema.js";

const SCHEMA = { ...catalogueModule };

const { sqlClient, db } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db };
export type Db = typeof db;
