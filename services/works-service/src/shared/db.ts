import { createTenantDb } from "@civitasone/db";
import { outboxSchema } from "./outbox.js";
import { schema as mastersModule } from "../modules/masters/schema.js";
import { schema as proposalModule } from "../modules/proposal/schema.js";
import { schema as approvalModule } from "../modules/approval/schema.js";
import { schema as boqModule } from "../modules/boq/schema.js";
import { schema as tenderModule } from "../modules/tender/schema.js";
import { schema as executionModule } from "../modules/execution/schema.js";
import { schema as billingModule } from "../modules/billing/schema.js";

export const worksSchemaMap = {
  ...mastersModule,
  ...proposalModule,
  ...approvalModule,
  ...boqModule,
  ...tenderModule,
  ...executionModule,
  ...billingModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: worksSchemaMap });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;

type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn as Parameters<Db["transaction"]>[0]) as Promise<T>;
}
