import { createTenantDb } from "@civitasone/db";
import { schema as requestsModule } from "../modules/requests/schema.js";
import { schema as processingModule } from "../modules/processing/schema.js";
import { schema as reconciliationModule } from "../modules/reconciliation/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...requestsModule,
  ...processingModule,
  ...reconciliationModule,
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
