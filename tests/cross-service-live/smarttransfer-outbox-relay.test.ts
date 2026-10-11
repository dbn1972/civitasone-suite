/**
 * tests/cross-service-live/smarttransfer-outbox-relay.test.ts (D-17).
 *
 * Proves the SmartTransfer hand-off to the rest of the fleet end to end against a
 * real Postgres as the NON-SUPERUSER smarttransfer_svc role (FORCE RLS live) and
 * a real MemoryQueue with the production relayOnce:
 *
 *   command smarttransfer.cycle.create -> consumer (markProcessed + guarded
 *   insert + audit outbox row + command result, one tx) -> _outbox.messages
 *   (FORCE RLS) -> relayOnce as the BYPASSRLS smarttransfer_scanner role ->
 *   queue -> a downstream audit.event.record subscriber, tenant + payload intact.
 *
 * The service role alone relays ZERO rows (that is the point of FORCE RLS on the
 * outbox and the scanner split), asserted first. Run against a disposable
 * Postgres bootstrapped with scripts/ci/bootstrap-postgres.sh (see harness.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { relayOnce, type DrizzleTx } from "@civitasone/outbox";
import { runWithTenant, eq } from "@civitasone/db";
import { LiveHarness, assertFresh, tenant, harnessPgHost, harnessPgPort, type MountedService } from "./harness.js";

const ACTOR = randomUUID();
let h: LiveHarness;
let st: MountedService;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let scannerClient: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let scannerDb: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cycles: any;

beforeAll(async () => {
  h = new LiveHarness();
  st = await h.mount("smarttransfer-service");
  await assertFresh([st]);
  // The service's own scanner pool (BYPASSRLS smarttransfer_scanner), bound from the
  // env DSN at first import - set it before the dynamic import, as mountService does.
  process.env.SMARTTRANSFER_SCANNER_DATABASE_URL ??=
    `postgres://smarttransfer_scanner:smarttransfer_scanner_dev_pw@${harnessPgHost()}:${harnessPgPort()}/civitas_smarttransfer`;
  ({ scannerSqlClient: scannerClient, scannerDb } = await import(
    "../../services/smarttransfer-service/src/shared/scanner-db.js"
  ));
  ({ cycles } = await import("../../services/smarttransfer-service/src/modules/movement/schema.js"));
  await h.tap();
  const { registerMovementConsumers } = await import(
    "../../services/smarttransfer-service/src/modules/movement/consumer.js"
  );
  registerMovementConsumers(h.queue);
  await h.start();
});

afterAll(async () => {
  if (scannerClient) await scannerClient.end({ timeout: 5 });
  if (h) await h.stop();
});

describe("smarttransfer command -> outbox -> scanner relay -> downstream subscriber", () => {
  it("writes the cycle + audit outbox row under FORCE RLS and relays it only via the scanner role", async () => {
    const t = tenant();
    const cycleId = randomUUID();
    const messageId = randomUUID();

    const seen: Array<{ tenantId: string; messageId: string }> = [];
    h.queue.subscribe("audit.event.record", async (msg: { tenantId: string; messageId: string }) => {
      if (msg.tenantId === t) seen.push({ tenantId: msg.tenantId, messageId: msg.messageId });
    });

    await h.queue.publish("smarttransfer.cycle.create", {
      messageId,
      type: "smarttransfer.cycle.create",
      tenantId: t,
      actorId: ACTOR,
      correlationId: "c-live",
      schemaVersion: "1.0",
      payload: {
        id: cycleId,
        tenantId: t,
        name: "Live cycle",
        movementTypeId: randomUUID(),
        calendar: {
          opensAt: "2026-01-01T00:00:00.000Z",
          freezesAt: "2026-02-01T00:00:00.000Z",
          closesAt: "2026-03-01T00:00:00.000Z",
        },
        jurisdictionUnitId: null,
      },
    });
    await h.queue.drain();

    // The domain row exists for its tenant only.
    const rows = await runWithTenant(t, () =>
      st.db.transaction((tx: typeof st.db) => tx.select().from(cycles).where(eq(cycles.id, cycleId))),
    );
    expect(rows.length).toBe(1);

    // The service role (NOBYPASSRLS, no GUC) relays NOTHING: FORCE RLS on the outbox.
    expect(await relayOnce(st.db as DrizzleTx, h.queue, 100, "smarttransfer")).toBe(0);
    expect(seen.length).toBe(0);

    // The BYPASSRLS scanner relays it across tenants with the production relayOnce.
      const relayed = await relayOnce(scannerDb as unknown as DrizzleTx, h.queue, 100, "smarttransfer");
    expect(relayed).toBeGreaterThanOrEqual(1);
    await h.queue.drain();

    expect(seen.length).toBe(1);
    expect(seen[0]!.tenantId).toBe(t);

    // Nothing left unpublished for this tenant, and no refusal was acked silently.
    const [left] = await scannerClient`select count(*)::int as c from _outbox.messages where tenant_id = ${t} and published_at is null`;
    expect(left!.c).toBe(0);
    const silent = await h.silent([t]);
    expect(silent.deadLetters.length).toBe(0);
    expect(silent.recordedOutcomes["smarttransfer-service"]).toEqual([]);
  });
});
