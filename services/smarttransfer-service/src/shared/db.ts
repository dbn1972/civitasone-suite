/**
 * smarttransfer-service DB connection.
 * Connects with the smarttransfer_svc role to civitas_smarttransfer ONLY.
 * It owns the movement entities and NEVER writes HRMS / Workforce Core tables
 * (D-ST-10) — those change only through the applyPosting command.
 */
import { createTenantDb } from "@civitasone/db";
import { schema as movementModule } from "../modules/movement/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...movementModule,
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
