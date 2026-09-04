/**
 * Shared helpers for this service's real, DB-backed consumer tests
 * (applications/approvals/permits/enforcement consumer.test.ts).
 *
 * These replaced 4 fully vi.mock'd consumer.test.ts files that never
 * touched Postgres at all — now that CI actually bootstraps and migrates a
 * real database for this service (PR #1000 wired advertisement-service into
 * scripts/ci/bootstrap-postgres.sh's SERVICE_DBS map), the tests run
 * against it instead.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { db, type ScopedTx } from "./db.js";

export const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

export function tokenForTenant(tenantId: string, actorId: string, roles: string[]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: `sess-${randomUUID()}` }, JWT_SECRET, 3600);
}

/** Poll-wait for a queue-delivered command's consumer to finish its async work. */
export function settle(ms = 150): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class RollbackForTestCleanup extends Error {}

/**
 * Run fn inside a transaction with app.tenant_id GUC set for that tenant
 * (SET LOCAL, so it never escapes the transaction), then always roll back —
 * so direct-repo test fixtures/assertions never leave rows behind in the
 * shared test database. Mirrors
 * services/refund-service/tests/race-guard-integration.test.ts's
 * withTenantTx, the established pattern in this repo for repo-level
 * DB-backed tests.
 */
export async function withTenantTx<T>(tenantId: string, fn: (tx: ScopedTx) => Promise<T>): Promise<void> {
  await expectRollback(
    db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${assertUuid(tenantId)}'`));
      await fn(tx);
      throw new RollbackForTestCleanup();
    }),
  );
}

async function expectRollback(p: Promise<unknown>): Promise<void> {
  try {
    await p;
    throw new Error("withTenantTx: fn completed without the expected rollback sentinel");
  } catch (err) {
    if (err instanceof RollbackForTestCleanup) return;
    throw err;
  }
}

function assertUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`assertUuid: '${id}' is not a well-formed UUID — refusing to inline it as raw SQL`);
  }
  return id;
}
