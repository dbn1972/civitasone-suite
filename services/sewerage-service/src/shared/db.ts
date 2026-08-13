import { createTenantDb } from "@civitasone/db";
import { schema as connectionsModule } from "../modules/connections/schema.js";
import { schema as billingModule } from "../modules/billing/schema.js";
import { schema as complaintsModule } from "../modules/complaints/schema.js";
import { schema as desludgingModule } from "../modules/desludging/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...connectionsModule,
  ...billingModule,
  ...complaintsModule,
  ...desludgingModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
export type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return db.transaction(fn as (tx: ScopedTx) => Promise<T>);
}
