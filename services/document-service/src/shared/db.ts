import { createTenantDb } from "@civitasone/db";
import { schema as filesModule }    from "../modules/files/schema.js";
import { schema as foldersModule }  from "../modules/folders/schema.js";
import { schema as workflowModule } from "../modules/workflow/schema.js";
import { schema as sharingModule }  from "../modules/sharing/schema.js";
import { outboxSchema }             from "./outbox.js";

const SCHEMA = {
  ...filesModule,
  ...foldersModule,
  ...workflowModule,
  ...sharingModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export function scopedRead<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(fn as never) as Promise<T>;
}

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
