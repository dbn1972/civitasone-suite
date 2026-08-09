import { createTenantDb } from "@civitasone/db";
import { schema as facilitiesModule } from "../modules/facilities/schema.js";
import { schema as bookingsModule } from "../modules/bookings/schema.js";
import { schema as recordsModule } from "../modules/records/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...facilitiesModule,
  ...bookingsModule,
  ...recordsModule,
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
