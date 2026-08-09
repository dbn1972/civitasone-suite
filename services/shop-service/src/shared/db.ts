import { createTenantDb } from "@civitasone/db";
import { schema as registrationsModule } from "../modules/registrations/schema.js";
import { schema as approvalsModule } from "../modules/approvals/schema.js";
import { schema as permitsModule } from "../modules/permits/schema.js";
import { schema as lifecycleModule } from "../modules/lifecycle/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...registrationsModule,
  ...approvalsModule,
  ...permitsModule,
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
