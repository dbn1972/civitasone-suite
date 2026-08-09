import { createTenantDb } from "@civitasone/db";
import { schema as complaintsModule } from "../modules/complaints/schema.js";
import { schema as fieldActionsModule } from "../modules/field_actions/schema.js";
import { schema as hotspotsModule } from "../modules/hotspots/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...complaintsModule,
  ...fieldActionsModule,
  ...hotspotsModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
export type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return db.transaction(fn as (tx: ScopedTx) => Promise<T>);
}
