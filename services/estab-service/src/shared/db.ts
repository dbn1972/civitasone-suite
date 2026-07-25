import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, TenantRouter, envTenantResolver, cachedResolver, wrapWithTenantGuc } from "@civitasone/db";
import { schema as filesModule }      from "../modules/files/schema.js";
import { schema as committeeModule }  from "../modules/committee/schema.js";
import { schema as assetsModule }     from "../modules/assets/schema.js";
import { schema as facilitiesModule } from "../modules/facilities/schema.js";
import { schema as legalModule }      from "../modules/legal/schema.js";
import { schema as approvalRulesModule } from "../modules/approval-rules/schema.js";
import { schema as dfaModule }         from "../modules/dfa/schema.js";
import { schema as handoverModule }    from "../modules/handover/schema.js";
import { schema as migrationModule }   from "../modules/migration/schema.js";
import { schema as operatorsModule }   from "../modules/operators/schema.js";
import { schema as quartersModule }    from "../modules/quarters/schema.js";
import { schema as fleetModule }       from "../modules/fleet/schema.js";
import { schema as spacesModule }      from "../modules/spaces/schema.js";
import { outboxSchema }               from "./outbox.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://estab_svc:***@host/civitas_estab)");

export const sqlClient = createSqlClient(url);

const ESTAB_SCHEMA = {
  ...filesModule, ...committeeModule, ...assetsModule, ...facilitiesModule, ...legalModule,
  ...approvalRulesModule, ...dfaModule, ...handoverModule, ...migrationModule, ...operatorsModule,
  ...quartersModule, ...fleetModule, ...spacesModule,
  ...outboxSchema,
};

const _rawDb = drizzle(sqlClient, { schema: ESTAB_SCHEMA });

export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;

// ── Tiered multi-tenancy (Option B) ──────────────────────────────────────────
// Pool tenants reuse the shared `sqlClient` above (no second connection); silo
// tenants get a client to their dedicated DB. With no TENANT_SILO_IDS configured
// every tenant resolves to pool, so this is fully backward compatible.
const router = new TenantRouter({
  poolDsn: url,
  resolver: cachedResolver(envTenantResolver()),
  clientFactory: (dsn, opts) => (dsn === url ? sqlClient : createSqlClient(dsn, opts)),
});

const drizzleByClient = new WeakMap<ReturnType<typeof createSqlClient>, Db>();

/** The raw postgres-js client for a tenant (pool shared client or silo client). */
export async function sqlClientFor(tenantId: string): Promise<ReturnType<typeof createSqlClient>> {
  return router.sqlFor(tenantId);
}

/** A Drizzle db bound to the tenant's tier (cached per underlying client). */
export async function dbFor(tenantId: string): Promise<Db> {
  const client = await router.sqlFor(tenantId);
  let d = drizzleByClient.get(client);
  if (!d) {
    d = drizzle(client, { schema: ESTAB_SCHEMA });
    drizzleByClient.set(client, d);
  }
  return d;
}

/** Tenant isolation tier (for observability / routing decisions). */
export async function tierOf(tenantId: string): Promise<"pool" | "silo"> {
  return router.tierOf(tenantId) as Promise<"pool" | "silo">;
}
