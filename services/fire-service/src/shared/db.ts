import { createTenantDb } from "@civitasone/db";
import { schema as applicationsModule } from "../modules/applications/schema.js";
import { schema as inspectionsModule } from "../modules/inspections/schema.js";
import { schema as nocsModule } from "../modules/nocs/schema.js";
import { schema as lifecycleModule } from "../modules/lifecycle/schema.js";

import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...applicationsModule,
  ...inspectionsModule,
  ...nocsModule,
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
