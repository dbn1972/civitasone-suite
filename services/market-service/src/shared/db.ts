import { createTenantDb } from "@civitasone/db";
import { schema as propertiesModule } from "../modules/properties/schema.js";
import { schema as allotmentsModule } from "../modules/allotments/schema.js";
import { schema as billingModule } from "../modules/billing/schema.js";
import { schema as lifecycleModule } from "../modules/lifecycle/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...propertiesModule,
  ...allotmentsModule,
  ...billingModule,
  ...lifecycleModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { ScopedTx };

export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
