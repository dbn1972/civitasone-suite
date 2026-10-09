/**
 * tests/cross-service-live/harness.selftest.test.ts — proves the v0 harness
 * (PR-FF02-06a). Design: FF-02.md WP6; 06-verification.md §2.3. Decision D-17.
 *
 * Two things the harness MUST do, proved against a real Postgres as the
 * NON-SUPERUSER finance_svc role (so FORCE RLS is live) and a real MemoryQueue
 * with the production relayOnce:
 *
 *   1. A cross-tenant read is refused. A finance_heads row written under tenant
 *      A is invisible to a read scoped to tenant B — because finance_svc is
 *      NOBYPASSRLS and FORCE ROW LEVEL SECURITY is on the table. If the harness
 *      ever connected as a superuser or BYPASSRLS role this test would see the
 *      row and fail: that is the point — it guards that RLS is genuinely
 *      exercised, not bypassed.
 *
 *   2. drain() relays outbox -> queue -> consumer. An event enqueued into
 *      finance's _outbox in the same tenant transaction as a write is moved to
 *      the shared queue by relayAll() (relayOnce + queue.drain()) and delivered
 *      to a real subscribed consumer, with its tenant and payload intact. No
 *      fixed sleeps: relayAll() runs to quiescence.
 *
 * HOW TO RUN (own disposable Postgres, non-superuser roles, --maxWorkers=2):
 *   export PGHOST=localhost PGPORT=<free port>
 *   export PII_ENC_KEY="$PII_ENC_KEY"   # inherited from the secret manager / CI
 *   PGPORT=$PGPORT bash scripts/ci/bootstrap-postgres.sh
 *   pnpm exec vitest run --maxWorkers=2 tests/cross-service-live/harness.selftest.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenantScope, eq, sql } from "@civitasone/db";
import { enqueue } from "@civitasone/outbox";
import { LiveHarness, assertFresh, tenant, type MountedService } from "./harness.js";

const ACTOR = randomUUID();

let h: LiveHarness;
let finance: MountedService;
let notification: MountedService;
// finance_heads Drizzle table is loaded after the service is mounted (its
// db.ts must bind first against civitas_finance as finance_svc).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let financeHeads: any;

beforeAll(async () => {
  h = new LiveHarness();
  // PII_ENC_KEY is NOT inlined here: mount() does `process.env[k] ?? v`, so the
  // self-test inherits it from the ambient environment (CI's Tests job exports
  // it at ci.yml:1629; locally, export it — see HOW TO RUN above). The self-test
  // never exercises PII crypto itself; finance's modules only read the key
  // lazily. Hardcoding a secret-shaped literal here is forbidden (house rule 10;
  // inline scanner allow-directives are not permitted either).
  finance = await h.mount("finance-service");
  // notification-service owns _inbox.command_results (migration 0048); mounted
  // so silent() can be proven to SEE rows through the tenant GUC.
  notification = await h.mount("notification-service");
  await assertFresh([finance, notification]);
  ({ financeHeads } = await import(
    "../../services/finance-service/src/modules/budget/schema.js"
  ));
  await h.tap();
  await h.start();
});

afterAll(async () => {
  if (h) await h.stop();
});

describe("harness v0 — RLS is genuinely exercised (non-superuser service role)", () => {
  it("refuses a cross-tenant read of a FORCE-RLS table", async () => {
    const tenantA = tenant();
    const tenantB = tenant();
    const headId = randomUUID();
    const code = `H-${headId.slice(0, 8)}`;

    // Write a head under tenant A, inside A's tenant GUC scope.
    await withTenantScope(finance.db, tenantA, async (tx: typeof finance.db) =>
      tx.insert(financeHeads).values({
        id: headId,
        tenantId: tenantA,
        code,
        name: "Harness RLS probe head",
        level: 1,
        classification: "asset",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    );

    // Tenant A sees its own row.
    const asA = await withTenantScope(finance.db, tenantA, async (tx: typeof finance.db) =>
      tx.select().from(financeHeads).where(eq(financeHeads.id, headId)),
    );
    expect(asA.length, "tenant A must see the row it wrote").toBe(1);

    // Tenant B must NOT see tenant A's row — FORCE RLS under a NOBYPASSRLS role.
    const asB = await withTenantScope(finance.db, tenantB, async (tx: typeof finance.db) =>
      tx.select().from(financeHeads).where(eq(financeHeads.id, headId)),
    );
    expect(asB.length, "a cross-tenant read must be refused (zero rows under RLS)").toBe(0);
  });
});

describe("harness v0 — drain() relays outbox -> queue -> consumer", () => {
  it("delivers an enqueued event to a real consumer with tenant and payload intact", async () => {
    const tenantA = tenant();
    const topic = "harness.selftest.event";
    const marker = randomUUID();

    // A real consumer on the shared queue. It is registered directly (no tenant
    // GUC): the harness has no tenant-scoped queue; real consumers wrap with the
    // owning service's own tenantScoped().
    const received: Array<{ tenantId: string; marker: string }> = [];
    h.queue.subscribe(topic, async (msg: {
      tenantId: string;
      payload: { marker: string };
    }) => {
      received.push({ tenantId: msg.tenantId, marker: msg.payload.marker });
    });

    // Enqueue into finance's real outbox, in a tenant-scoped transaction (the
    // same shape a real consumer uses: write + outbox row in one tx).
    await withTenantScope(finance.db, tenantA, async (tx: typeof finance.db) => {
      await enqueue(tx, {
        topic,
        eventType: topic,
        tenantId: tenantA,
        actorId: ACTOR,
        correlationId: randomUUID(),
        payload: { marker },
      });
    });

    // Before relay: nothing delivered.
    expect(received.length).toBe(0);

    // relayAll() = relayOnce(finance) + queue.drain(), to quiescence.
    const relayed = await h.relayAll();
    expect(relayed, "at least one row should relay").toBeGreaterThanOrEqual(1);

    // The consumer ran, with the right tenant and payload, exactly once.
    const ours = received.filter((r) => r.marker === marker);
    expect(ours.length, "the enqueued event must reach the consumer exactly once").toBe(1);
    expect(ours[0]!.tenantId, "tenant must survive the hand-off").toBe(tenantA);

    // tap() recorded the boundary crossing and the transport envelope is valid.
    const mine = h.tapped.filter((t) => t.topic === topic);
    expect(mine.length, "tap() must record the boundary-crossing envelope").toBeGreaterThanOrEqual(1);
    expect(mine.every((t) => t.valid), "the transport envelope must validate").toBe(true);
    expect(mine.every((t) => t.tenantId === tenantA)).toBe(true);
  });
});

describe("harness v0 — silent() sees recorded command outcomes through tenant scope", () => {
  it("reports a failed command_results row for its tenant only", async () => {
    const tenantA = tenant();
    const tenantB = tenant();
    const messageId = randomUUID();

    await withTenantScope(notification.db, tenantA, async (tx: typeof notification.db) =>
      tx.execute(sql`
        insert into _inbox.command_results (message_id, tenant_id, topic, status, reason)
        values (${messageId}, ${tenantA}, 'harness.selftest.cmd', 'failed', 'selftest')`),
    );

    const asA = await h.silent([tenantA]);
    expect(
      asA.recordedOutcomes["notification-service"]!.map((r) => r.messageId),
      "silent([A]) must see the failed row seeded under tenant A",
    ).toContain(messageId);

    const asB = await h.silent([tenantB]);
    expect(
      asB.recordedOutcomes["notification-service"]!.map((r) => r.messageId),
      "silent([B]) must not see tenant A's row",
    ).not.toContain(messageId);

    // finance has no command_results table yet: 42P01 is tolerated, not an error.
    expect(asA.recordedOutcomes["finance-service"]).toEqual([]);
  });
});
