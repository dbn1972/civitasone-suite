import { createTenantDb } from "@civitasone/db";
import { schema as complaintsModule } from "../modules/complaints/schema.js";
import { schema as operationsModule } from "../modules/operations/schema.js";
import { schema as registrationModule } from "../modules/registration/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...complaintsModule,
  ...operationsModule,
  ...registrationModule,
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
