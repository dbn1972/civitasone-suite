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
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerF3_uploads_Consumers } = await import("../src/modules/uploads/doc-f3-consumer.js");

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
  // Same F3 wiring + "one consumer per shared-topic test file" workaround as
  // tests/doc-governance-routes.test.ts / tests/central-config.test.ts (see
  // those files' beforeAll comments for the full writeup of the shared
  // admin.f3.route_write topic + MemoryQueue per-message dedup issue).
  registerF3_uploads_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => {
  await wipe();
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

async function drainQueue(): Promise<void> {
  await (queue as any).drain?.();
}

interface DocType { id: string; code: string; version: number }
interface Doc { id: string; status: string; storageKey: string }
interface ListBody<T> { data: T[] }

async function findTypeByCode(code: string): Promise<DocType> {
  const res = await app.inject({ method: "GET", url: "/v1/admin/document-types?limit=200", headers: auth() });
  const found = (res.json() as ListBody<DocType>).data.find((r) => r.code === code);
  if (!found) throw new Error(`document type '${code}' never landed — F3 consumer not draining`);
  return found;
}

/**
 * document-types create is F3 async (202) — doc-f3-apply.ts's create op
 * mints its own id inside the consumer rather than forwarding the
 * route-generated one (same class of bug documented in
 * tests/doc-governance-routes.test.ts's createType() and
 * tests/integration-ops.test.ts / tests/central-config.test.ts). Look the
 * real row up by its (caller-supplied, unique) code instead of trusting the
 * id echoed in the 202 response.
 */
async function createType(over: Record<string, unknown>): Promise<DocType> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/document-types", headers: auth(),
    payload: { name: "Narrowing window", ...over },
  });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return findTypeByCode(over.code as string);
}

async function findDocumentByStorageKey(storageKey: string): Promise<Doc> {
  const res = await app.inject({ method: "GET", url: "/v1/admin/documents?limit=200", headers: auth() });
  const found = (res.json() as ListBody<Doc>).data.find((d) => d.storageKey === storageKey);
  if (!found) throw new Error(`document '${storageKey}' never landed — F3 consumer not draining`);
  return found;
}

/** Same async + id-mismatch pattern as createType() above. */
async function registerDoc(over: Record<string, unknown>): Promise<Doc> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/documents", headers: auth(),
    payload: { contextType: "employee_onboarding", contextKey: "emp-desc-1", ...over },
  });
  expect(res.statusCode).toBe(202);
  await drainQueue();
  return findDocumentByStorageKey(over.storageKey as string);
}

interface ScanResult {
  scanned: number; expiring: number; expired: number; unchanged: number; recovered: number;
}

async function outboxTopics(): Promise<string[]> {
  const rows = await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.select({ topic: outboxMessages.topic }).from(outboxMessages)
      .where(eq(outboxMessages.tenantId, TENANT))));
  return rows.map((r) => r.topic);
}

/**
 * The scan route is F3 async too (doc-routes.ts's expiry-scan op): the 200
 * response body is now just `{ data: { id, status: 'accepted', ... } }` —
 * none of scanned/expiring/expired/unchanged/recovered are echoed
 * synchronously any more (apply_uploads_4 in doc-f3-apply.ts computes and
 * applies them entirely inside the async consumer). Source the real counters
 * from the 'document.expiry_scan' audit-outbox record the consumer writes in
 * the SAME transaction as its updates — same technique as
 * tests/doc-governance-routes.test.ts's lastScanStats(), extended here with
 * `recovered` (which this file, unlike that one, needs).
 */
async function scan(): Promise<ScanResult> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/documents/expiry-scan", headers: auth(), payload: { limit: 200 },
  });
  expect(res.statusCode).toBe(200);
  await drainQueue();
  const rows = await asTenant((sql) => sql<Array<{ payload: Record<string, unknown> }>>`
    SELECT payload FROM _outbox.messages
    WHERE topic = 'audit.event.record' AND payload->>'action' = 'document.expiry_scan'
    ORDER BY created_at DESC LIMIT 1`);
  const p = rows[0]?.payload ?? {};
  return {
    scanned: Number(p.scanned ?? 0),
    expiring: Number(p.expiring ?? 0),
    expired: Number(p.expired ?? 0),
    unchanged: Number(p.unchanged ?? 0),
    recovered: Number(p.recovered ?? 0),
  };
}

describe("DM-002 expiry scan — de-escalation when the warning window narrows", () => {
  let typeId = "";
  let docId = "";

  beforeAll(async () => {
    const type = await createType({ code: "desc-licence", expiryWarnDays: 30 });
    typeId = type.id;

    // 10 days out with a 30-day window ⇒ registers as `expiring` immediately.
    const doc = await registerDoc({
      documentTypeCode: "desc-licence",
      storageKey: "uploads/desc/licence.pdf",
      expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    });
    expect(doc.status).toBe("expiring");
    docId = doc.id;

    // Narrow the window to 1 day — the document is no longer within it. PATCH
    // is F3 async too (200 body is just the accepted envelope) — land it
    // before the scan below reads the type's warn-days.
    const patched = await app.inject({
      method: "PATCH", url: `/v1/admin/document-types/${typeId}`, headers: auth(),
      payload: { expectedVersion: type.version, expiryWarnDays: 1 },
    });
    expect(patched.statusCode).toBe(200);
    await drainQueue();
  });

  it("re-classifies the document back to active", async () => {
    const before = await outboxTopics();

    const result = await scan();
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

    const result = await scan();

    // Every scanned document must be attributable to exactly one outcome,
    // otherwise the scan's own report hides work it did.
    expect(result.recovered).toBe(1);
    expect(result.expiring + result.expired + result.unchanged + result.recovered).toBe(result.scanned);
  });

  it("is idempotent once the document has settled back to active", async () => {
    const result = await scan();
    expect(result.unchanged).toBe(1);
    expect(result.recovered).toBe(0);
    expect(result.expiring).toBe(0);
  });
});
