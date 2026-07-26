/**
 * Tenant-scoped transaction helper.
 *
 * Every read and write in this service runs inside a transaction that sets the
 * `app.tenant_id` GUC, so PostgreSQL RLS (ENABLE + FORCE on every metadata table,
 * with the service role NOBYPASSRLS) enforces tenant isolation at runtime — not
 * merely as an advisory `WHERE tenant_id = $1` clause. A bare `db.select()` with
 * no GUC set would match zero rows under FORCE RLS, so all data access funnels
 * through here.
 */
import { sql } from "drizzle-orm";
import { db } from "./db.js";

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run `fn` inside a transaction with `app.tenant_id` set to `tenantId`.
 * The maker-checker / validation logic runs inside the same tx as the write,
 * so partial state can never be committed.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!TENANT_ID_RE.test(tenantId)) throw new Error("withTenant: invalid tenantId");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as Tx);
  });
}
