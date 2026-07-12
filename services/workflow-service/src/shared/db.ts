import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, wrapWithTenantGuc } from "@civitasone/db";
import { schema as instancesModule } from "../modules/instances/schema.js";
import { schema as tasksModule } from "../modules/tasks/schema.js";
import { schema as definitionsModule } from "../modules/definitions/schema.js";
import { schema as historyModule } from "../modules/history/schema.js";
import { schema as delegationsModule } from "../modules/delegations/schema.js";
import { roleMembers, assignmentCursors } from "../modules/assignment/resolver.js";
import { schema as assignmentModule } from "../modules/assignment/schema.js";
import { consumerAttempts, deadLetters } from "../modules/dlq/repo.js";
import { outboxSchema } from "./outbox.js";
import { schema as messagesModule } from "../modules/messages/schema.js";
import { schema as decisionsModule } from "../modules/decisions/schema.js";
import { schema as forwardingModule } from "../modules/forwarding/schema.js";
import { schema as designerModule } from "../modules/designer/schema.js";
import { schema as dmnModule } from "../modules/dmn/schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (postgres://workflow_svc:***@host/civitas_workflow)");

export const sqlClient = createSqlClient(url);
const _rawDb = drizzle(sqlClient, {
  schema: { ...instancesModule, ...tasksModule, ...definitionsModule, ...historyModule, ...delegationsModule, roleMembers, assignmentCursors, ...assignmentModule, consumerAttempts, deadLetters, ...outboxSchema, ...messagesModule, ...decisionsModule, ...forwardingModule, ...designerModule },
});
export const db = wrapWithTenantGuc(_rawDb);
export type Db = typeof _rawDb;

/**
 * Run a READ inside the tenant transaction so PostgreSQL RLS is enforced on
 * the read path too. Plain `db.select()` runs on a pooled connection with no
 * `app.tenant_id` GUC set, so under a NOBYPASSRLS role the fail-closed policy
 * returns ZERO rows. Wrapping the read in `db.transaction` makes the wrapper
 * set the GUC from AsyncLocalStorage -- reads are then correctly tenant-scoped
 * by RLS, not merely by an app-layer WHERE.
 */
type ScopedTx = Parameters<Parameters<typeof _rawDb.transaction>[0]>[0];
export function scopedRead<T>(fn: (tx: ScopedTx) => PromiseLike<T>): Promise<T> {
  return db.transaction(fn as (tx: ScopedTx) => Promise<T>);
}
