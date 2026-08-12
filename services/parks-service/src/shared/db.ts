import { createTenantDb } from "@civitasone/db";
import { outboxSchema } from "@civitasone/outbox";
import { schema as complaintsSchema } from "../modules/complaints/schema.js";
import { schema as treeRequestsSchema } from "../modules/tree_requests/schema.js";
import { schema as inspectionsSchema } from "../modules/inspections/schema.js";
import { schema as assetsSchema } from "../modules/assets/schema.js";

const SCHEMA = {
  ...complaintsSchema,
  ...treeRequestsSchema,
  ...inspectionsSchema,
  ...assetsSchema,
  ...outboxSchema,
};

export const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } =
  createTenantDb({ schema: SCHEMA });

export type Db = typeof db;
export type ScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function scopedRead<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
