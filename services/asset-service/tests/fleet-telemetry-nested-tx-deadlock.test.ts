/**
 * asset-service fleetDeviceTelemetry nested-transaction connection-pool
 * deadlock regression. Found via .claude/skills/16-production-readiness-audit.md
 * section 1: fleetDeviceTelemetry (fleet/consumer.ts) -- and its siblings
 * across lifecycle/depreciation/maintenance/enterprise (11 sites) plus
 * lifecycle/eoffice-consumer.ts (1 more, a partial-fix-left-unapplied case)
 * -- called repo.findDeviceById, a scopedRead-based function that opens its
 * OWN db.transaction(), from INSIDE its own already-open outer
 * db.transaction(). Real GPS telemetry ingestion under concurrent load
 * (many vehicles reporting position at once) is a realistic trigger. Same
 * shape as notification-service (#1028), building-service (#1035),
 * payroll-service (#1042, #1048), finance-service (#1043), hrms-service
 * (#1045, #1047), grant-service (#1049), billing-service (#1050), and
 * inspection-service (#1052, #1055, #1056, #1057, #1059, #1060, #1061,
 * #1062).
 *
 * Fixed by routing onto findDeviceByIdTx, reading through the callers
 * already-open tx.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerFleetConsumers } from "../src/modules/fleet/consumer.js";
import { fleetVehicles, fleetDevices } from "../src/modules/fleet/schema.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "f1ee0000-dead-4000-8000-00000000f1ee";
const ACTOR = "f1ee0000-dead-4000-8000-0000000ac70a";
const CONCURRENCY = 13; // pool.max (10) + 3

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

describe("asset-service fleetDeviceTelemetry -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    CONCURRENCY + " concurrent fleetDeviceTelemetry commands (each with a real registered device) drain without deadlocking the connection pool",
    async () => {
      const deviceIds: string[] = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const vehicleId = randomUUID();
        const deviceId = randomUUID();
        deviceIds.push(deviceId);
        await runWithTenant(TENANT, async () => {
          await db.transaction(async (tx) => {
            await tx.insert(fleetVehicles).values({
              id: vehicleId, tenantId: TENANT, registrationNo: "REG-" + i,
              status: "active", createdBy: ACTOR,
            });
            await tx.insert(fleetDevices).values({
              id: deviceId, tenantId: TENANT, vehicleId,
              deviceImei: "8" + randomUUID().replace(/\D/g, "").slice(0, 14).padEnd(14, "0"),
              protocol: "http", status: "active", createdBy: ACTOR,
            });
          });
        });
      }

      const q = tenantWrappedQueue();
      registerFleetConsumers(q);
      await q.start();

      await Promise.all(deviceIds.map((deviceId) =>
        q.publish(COMMANDS.fleetDeviceTelemetry, makeMsg(COMMANDS.fleetDeviceTelemetry, {
          deviceId, tenantId: TENANT, lat: 12.9716, lng: 77.5946,
          speed: 40, heading: 90, timestamp: new Date().toISOString(),
        })),
      ));

      const DRAIN_TIMEOUT_MS = 10000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);

      expect(timedOut, "queue did not drain within " + DRAIN_TIMEOUT_MS + "ms -- nested-transaction pool deadlock regressed").toBe(false);

      await q.stop();
    },
    { timeout: 20000 },
  );
});
