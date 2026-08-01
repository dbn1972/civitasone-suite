import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "asset-fleet-consumer" });
const AUDIT_TOPIC = "audit.event.record";

/**
 * Fleet + fleet-devices consumers (facade closure). fleet/routes.ts and
 * fleet-devices/routes.ts publish commands but, until this file, had no
 * consumer.ts — messages were black-holed (202 accepted, nothing persisted).
 *
 * Mirrors modules/maintenance/consumer.ts: run every handler inside the
 * message tenant context (tenantScoped) so NOBYPASSRLS + FORCE RLS accepts
 * consumer writes, idempotent via markProcessed(messageId) in the same tx.
 */
export function registerFleetConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // asset.fleet.create → asset.fleet_vehicles
  queue.subscribe(COMMANDS.fleetCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; registrationNo: string; make: string; model: string;
        year: number; fuelType: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertVehicle(tx, {
          id: p.id, tenantId: p.tenantId, registrationNo: p.registrationNo,
          make: p.make, model: p.model, year: p.year, fuelType: p.fuelType,
          status: "active", createdBy: msg.actorId,
        });
        await audit(tx, msg, "create", "fleet_vehicle", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.fleetCreate }, "Consumer processing failed");
    }
  });

  // asset.fleet.gps_update → asset.fleet_vehicles.current_lat/lng/last_gps_at
  queue.subscribe(COMMANDS.fleetGpsUpdate, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; lat: number; lng: number };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateVehiclePosition(tx, p.id, p.tenantId, {
          lat: String(p.lat), lng: String(p.lng), lastGpsAt: new Date(),
        });
        await audit(tx, msg, "gps_update", "fleet_vehicle", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.fleetGpsUpdate }, "Consumer processing failed");
    }
  });

  // asset.fleet.schedule_maintenance → asset.fleet_maintenance
  queue.subscribe(COMMANDS.fleetScheduleMaintenance, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; vehicleId: string; type: string;
        scheduledDate: string; odometerThresholdKm?: number;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertMaintenance(tx, {
          id: p.id, tenantId: p.tenantId, vehicleId: p.vehicleId, type: p.type,
          scheduledDate: p.scheduledDate.slice(0, 10),
          status: "scheduled", costMinor: null,
          odometerThresholdKm: p.odometerThresholdKm ?? null,
          createdBy: msg.actorId,
        });
        await audit(tx, msg, "schedule", "fleet_maintenance", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.fleetScheduleMaintenance }, "Consumer processing failed");
    }
  });

  // asset.fleet_device.register → asset.fleet_devices
  queue.subscribe(COMMANDS.fleetDeviceRegister, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; vehicleId: string; deviceImei: string;
        protocol: string; simIccid?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertDevice(tx, {
          id: p.id, tenantId: p.tenantId, vehicleId: p.vehicleId,
          deviceImei: p.deviceImei, protocol: p.protocol,
          simIccid: p.simIccid ?? null, status: "active", createdBy: msg.actorId,
        });
        await audit(tx, msg, "register", "fleet_device", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.fleetDeviceRegister }, "Consumer processing failed");
    }
  });

  // asset.fleet_device.telemetry → asset.fleet_device_telemetry
  // (+ mirrors position/fuel onto the linked vehicle, same as GPS update).
  queue.subscribe(COMMANDS.fleetDeviceTelemetry, async (msg) => {
    try {
      const p = msg.payload as {
        deviceId: string; tenantId: string; lat: number; lng: number; speed: number;
        heading: number; fuelLevelPct?: number; engineOn?: boolean; timestamp: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertTelemetry(tx, {
          tenantId: p.tenantId, deviceId: p.deviceId,
          lat: String(p.lat), lng: String(p.lng),
          speed: String(p.speed), heading: String(p.heading),
          fuelLevelPct: p.fuelLevelPct ?? null, engineOn: p.engineOn ?? null,
          recordedAt: new Date(p.timestamp),
        });
        const device = await repo.findDeviceById(p.deviceId, p.tenantId);
        if (device) {
          await repo.updateVehiclePosition(tx, device.vehicleId, p.tenantId, {
            lat: String(p.lat), lng: String(p.lng),
            fuelLevelPct: p.fuelLevelPct ?? undefined, lastGpsAt: new Date(p.timestamp),
          });
        }
        await audit(tx, msg, "telemetry", "fleet_device", p.deviceId);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.fleetDeviceTelemetry }, "Consumer processing failed");
    }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
