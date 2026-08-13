import { createTenantDb, runWithTenant } from "@civitasone/db";
import { rolesModuleSchema } from "../modules/roles/schema.js";
import { bindingsModuleSchema } from "../modules/bindings/schema.js";
import { abacModuleSchema } from "../modules/abac/schema.js";
import { schema as roleFeaturesModule } from "../modules/role-features/schema.js";
import { policiesModuleSchema } from "../modules/policies/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...rolesModuleSchema,
  ...bindingsModuleSchema,
  ...abacModuleSchema,
  ...roleFeaturesModule,
  ...policiesModuleSchema,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function readScoped<T>(tenantId: string, fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as (tx: ScopedTx) => Promise<T>),
  ) as Promise<T>;
}
