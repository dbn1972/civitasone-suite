/**
 * inspection-service telemetry (readingIngest + alertAcknowledge)
 * nested-transaction connection-pool deadlock regression. Found via
 * .claude/skills/16-production-readiness-audit.md section 1, on a re-scan
 * after fixing a scanner limitation: readingIngest opens db.transaction()
 * and calls findDeviceById + findActiveAlertRules, and alertAcknowledge
 * opens db.transaction() and calls findAlertById -- all cache-wrapped (or
 * plain scopedRead-based) functions that each open their OWN
 * db.transaction() -- from INSIDE the already-open outer transaction.
 * Exercises both concurrently in one run.
 *
 * Fixed by routing onto findDeviceByIdTx / findActiveAlertRulesTx /
 * findAlertByIdTx, reading through the caller's already-open tx (and
 * deliberately bypassing the read-through cache where applicable).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerTelemetryConsumers } from "../src/modules/telemetry/consumer.js";
import { devices, telemetryAlerts } from "../src/modules/telemetry/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7e1e0000-dead-4000-8000-00007e1e0000";
const ACTOR = "7e1e0000-dead-4000-8000-0000000ac70a";
const BATCH = 7; // per command type; total concurrency (14) exceeds pool.max (10)

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

describe("inspection-service telemetry readingIngest+alertAcknowledge -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    "concurrent readingIngest+alertAcknowledge commands drain without deadlocking the connection pool",
    async () => {
      const deviceIds: string[] = [];
      const alertIds: string[] = [];
      for (let i = 0; i < BATCH; i++) {
        const deviceId = randomUUID();
        deviceIds.push(deviceId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(devices).values({
          id: deviceId, tenantId: TENANT, deviceType: "sensor",
          deviceIdentifier: "DEV-DEADLOCK-" + i + "-" + randomUUID().slice(0, 8),
          name: "Deadlock Test Device " + i, status: "active",
          createdBy: ACTOR, updatedBy: ACTOR,
        }));

        const alertId = randomUUID();
        alertIds.push(alertId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await withTenantScope(db, TENANT, (tx: any) => tx.insert(telemetryAlerts).values({
          id: alertId, tenantId: TENANT, deviceId, alertType: "threshold_exceeded",
          severity: "major", status: "open", createdBy: ACTOR, updatedBy: ACTOR,
        }));
      }

      const q = tenantWrappedQueue();
      registerTelemetryConsumers(q);
      await q.start();

      const publishes: Promise<unknown>[] = [];
      for (let i = 0; i < BATCH; i++) {
        publishes.push(q.publish(COMMANDS.readingIngest, makeMsg(COMMANDS.readingIngest, {
          deviceId: deviceIds[i], readingType: "temperature", value: "25.5", unit: "C",
          capturedAt: new Date().toISOString(),
        })));
        publishes.push(q.publish(COMMANDS.alertAcknowledge, makeMsg(COMMANDS.alertAcknowledge, {
          alertId: alertIds[i],
        })));
      }
      await Promise.all(publishes);

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-transaction pool deadlock regressed`).toBe(false);

      await q.stop();
    },
    { timeout: 20_000 },
  );
});
