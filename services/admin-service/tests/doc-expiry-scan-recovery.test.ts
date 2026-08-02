/**
 * DM-002 — the expiry scan's DE-ESCALATION path (expiring → active).
 *
 * Reachable whenever an administrator NARROWS a document type's warning window
 * after documents of that type have already been classified `expiring`: the
 * scan re-classifies them back to `active`. That transition is neither an
 * `expiring` alert nor an `expired` one, so it falls through both branches of
 * the scan's event dispatch.
 *
 * Two things are asserted here that the rest of the DM-002 suite does not cover:
 *   1. no alert event is published for a recovery (publishing "expiring" for a
 *      document that just stopped expiring would be a false alarm), and
 *   2. the scan's response counters ACCOUNT for the document. Before the fix in
 *      doc-routes.ts they did not: `scanned` was 1 while expiring/expired/
 *      unchanged were all 0, so a caller could not tell anything had happened,
 *      and `lastAlertAt` was stamped although no alert was sent.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { db, sqlClient } = await import("../src/shared/db.js");
const { outboxMessages } = await import("../src/shared/outbox.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = "de5ca000-0000-4000-8000-0000000000d1";
const ACTOR = "de5ca111-0000-4000-8000-0000000000d2";

function auth(): { authorization: string } {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["tenant_admin"], sid: "sess-desc" }, SECRET, 3600)}`,
  };
}

function asTenant<T>(run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function wipe(): Promise<void> {
  await asTenant(async (sql) => {
    await sql`DELETE FROM uploads.documents WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM uploads.document_requirements WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM uploads.document_types WHERE tenant_id = ${TENANT}`;
  });
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await wipe();
});
afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

interface ScanResult {
  scanned: number; expiring: number; expired: number; unchanged: number; recovered: number;
}

async function outboxTopics(): Promise<string[]> {
  const rows = await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.select({ topic: outboxMessages.topic }).from(outboxMessages)
      .where(eq(outboxMessages.tenantId, TENANT))));
  return rows.map((r) => r.topic);
}

describe("DM-002 expiry scan — de-escalation when the warning window narrows", () => {
  let typeId = "";
  let docId = "";

  beforeAll(async () => {
    const type = await app.inject({
      method: "POST", url: "/v1/admin/document-types", headers: auth(),
      payload: { code: "desc-licence", name: "Narrowing window", expiryWarnDays: 30 },
    });
    expect(type.statusCode).toBe(201);
    typeId = (type.json() as { data: { id: string } }).data.id;

    // 10 days out with a 30-day window ⇒ registers as `expiring` immediately.
    const doc = await app.inject({
      method: "POST", url: "/v1/admin/documents", headers: auth(),
      payload: {
        documentTypeCode: "desc-licence",
        contextType: "employee_onboarding", contextKey: "emp-desc-1",
        storageKey: "uploads/desc/licence.pdf",
        expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      },
    });
    expect(doc.statusCode).toBe(201);
    const created = (doc.json() as { data: { id: string; status: string } }).data;
    expect(created.status).toBe("expiring");
    docId = created.id;

    // Narrow the window to 1 day — the document is no longer within it.
    const patched = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${typeId}`, headers: auth(),
      payload: { expectedVersion: 1, expiryWarnDays: 1 },
    });
    expect(patched.statusCode).toBe(200);
  });

  it("re-classifies the document back to active", async () => {
    const before = await outboxTopics();

    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents/expiry-scan", headers: auth(), payload: { limit: 200 },
    });
    expect(res.statusCode).toBe(200);
    const result = (res.json() as { data: ScanResult }).data;

    expect(result.scanned).toBe(1);
    expect(result.expiring).toBe(0);
    expect(result.expired).toBe(0);

    const rows = await asTenant((sql) => sql<Array<{ status: string; last_alert_at: Date | null }>>`
      SELECT status, last_alert_at FROM uploads.documents WHERE id = ${docId}`);
    expect(rows[0]?.status).toBe("active");

    // A recovery is not an alert: nothing new may be published, and the
    // alert timestamp must not be stamped.
    const after = await outboxTopics();
    expect(after.filter((t) => t.includes("document.expir"))).toEqual(
      before.filter((t) => t.includes("document.expir")),
    );
    expect(rows[0]?.last_alert_at).toBeNull();
  });

  it("accounts for the transition in the response counters", async () => {
    // Re-run from a fresh expiring state to assert the counter in isolation.
    await asTenant(async (sql) => {
      await sql`UPDATE uploads.documents SET status = 'expiring', version = version + 1 WHERE id = ${docId}`;
    });

    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents/expiry-scan", headers: auth(), payload: { limit: 200 },
    });
    const result = (res.json() as { data: ScanResult }).data;

    // Every scanned document must be attributable to exactly one outcome,
    // otherwise the scan's own report hides work it did.
    expect(result.recovered).toBe(1);
    expect(result.expiring + result.expired + result.unchanged + result.recovered).toBe(result.scanned);
  });

  it("is idempotent once the document has settled back to active", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/documents/expiry-scan", headers: auth(), payload: { limit: 200 },
    });
    const result = (res.json() as { data: ScanResult }).data;
    expect(result.unchanged).toBe(1);
    expect(result.recovered).toBe(0);
    expect(result.expiring).toBe(0);
  });
});
