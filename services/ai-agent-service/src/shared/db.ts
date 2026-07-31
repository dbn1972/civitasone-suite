/**
 * ai-agent-service DB connection — TenantRouter adoption.
 * See packages/db/src/create-tenant-db.ts for the createTenantDb() contract.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as chatModule } from "../modules/chat/schema.js";
import { schema as copilotModule } from "../modules/copilot/schema.js";
import { schema as agentsModule } from "../modules/agents/schema.js";
import { schema as governanceModule } from "../modules/governance/schema.js";
import { schema as guardrailsModule } from "../modules/guardrails/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...chatModule,
  ...copilotModule,
  ...agentsModule,
  ...governanceModule,
  ...guardrailsModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { ScopedTx };

/**
 * Run a READ inside a tenant transaction so PostgreSQL RLS is enforced.
 */
export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
