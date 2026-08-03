/**
 * Spaces apply layer — DB writes for the spaces consumer (CQRS).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import {
  DomainError, assertValidAllotmentTransition, assertMakerChecker,
  assertSeatAllottable, assertRoomHasCapacity, assertRowUpdated,
  seatStatusOnAllot, seatStatusOnRelease,
} from "./domain.js";
import type {
  CreateBuildingBody, CreateFloorBody, CreateRoomBody, CreateSeatBody,
  RequestAllotmentBody, AllotBody, VersionBody, ReleaseBody, CancelBody,
  CreateMaintenanceBody, MaintenanceStatusBody,
} from "./validators.js";

export type Created = { id: string };
export type Applied = Created;
const AUDIT_TOPIC = "audit.event.record";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function audit(tx: any, ctx: RequestContext, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}

// Postgres unique-violation for the partial index that backstops one active
// allotment per seat. Surfaced when two concurrent allots both pass the in-tx
// availability check and race to write.
const PG_UNIQUE_VIOLATION = "23505";
const SEAT_ALLOT_UNIQUE = "uq_estab_active_seat_allotment";
const ROOM_CAPACITY_CONSTRAINT = "chk_room_allotment_capacity";

function toHttp(err: unknown): never {
  if (err instanceof DomainError) {
    const status = err.code === "MAKER_CHECKER_VIOLATION" ? 403
      : err.code === "SEAT_ALREADY_ALLOTTED" ? 409
      : err.code === "INVALID_TRANSITION" ? 409
      : err.code === "VERSION_CONFLICT" ? 409
      : err.code === "ROOM_AT_CAPACITY" ? 409
      : 400;
    throw new HttpError(status, err.code, err.message);
  }
  // Translate DB backstop violations (concurrent races that slipped past the
  // in-tx guards) into the same 409s the domain guards would have produced.
  const e = err as { code?: string; constraint_name?: string; message?: string };
  if (e && e.code === PG_UNIQUE_VIOLATION
      && (e.constraint_name === SEAT_ALLOT_UNIQUE || (e.message ?? "").includes(SEAT_ALLOT_UNIQUE))) {
    throw new HttpError(409, "SEAT_ALREADY_ALLOTTED", "seat already has an active allotment");
  }
  if (e && (e.constraint_name === ROOM_CAPACITY_CONSTRAINT || (e.message ?? "").includes(ROOM_CAPACITY_CONSTRAINT))) {
    throw new HttpError(409, "ROOM_AT_CAPACITY", "room is at capacity");
  }
  throw err;
}

// ── Inventory ──────────────────────────────────────────────────────────────
export async function createBuilding(ctx: RequestContext, body: CreateBuildingBody, id: string = randomUUID()): Promise<Created> {
  await repo.scopedTx(ctx.tenantId, async (tx) => {
    await repo.insertBuilding(tx, {
      id, tenantId: ctx.tenantId, code: body.code, name: body.name,
      address: body.address ?? null, orgUnit: body.orgUnit ?? null,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "building_created", "building", id);
  });
  return { id };
}

export async function createFloor(ctx: RequestContext, body: CreateFloorBody, id: string = randomUUID()): Promise<Created> {
  await repo.scopedTx(ctx.tenantId, async (tx) => {
    await repo.insertFloor(tx, {
      id, tenantId: ctx.tenantId, buildingId: body.buildingId,
      floorNo: body.floorNo, name: body.name ?? null,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "floor_created", "floor", id);
  });
  return { id };
}

export async function createRoom(ctx: RequestContext, body: CreateRoomBody, id: string = randomUUID()): Promise<Created> {
  await repo.scopedTx(ctx.tenantId, async (tx) => {
    await repo.insertRoom(tx, {
      id, tenantId: ctx.tenantId, floorId: body.floorId, roomNo: body.roomNo,
      name: body.name ?? null, roomType: body.roomType, capacity: body.capacity,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "room_created", "office_room", id);
  });
  return { id };
}

export async function createSeat(ctx: RequestContext, body: CreateSeatBody, id: string = randomUUID()): Promise<Created> {
  await repo.scopedTx(ctx.tenantId, async (tx) => {
    const room = await repo.findRoomById(tx, ctx.tenantId, body.roomId);
    if (!room) throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
    await repo.insertSeat(tx, {
      id, tenantId: ctx.tenantId, roomId: body.roomId, seatNo: body.seatNo,
      seatType: body.seatType, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "seat_created", "seat", id);
  });
  return { id };
}

// ── Allotment workflow ──────────────────────────────────────────────────────
export async function requestAllotment(ctx: RequestContext, body: RequestAllotmentBody, id: string = randomUUID()): Promise<Created> {
  await repo.scopedTx(ctx.tenantId, async (tx) => {
    if (body.targetType === "seat") {
      const seat = await repo.findSeatById(tx, ctx.tenantId, body.targetId);
      if (!seat) throw new HttpError(404, "SEAT_NOT_FOUND", "seat not found");
    } else {
      const room = await repo.findRoomById(tx, ctx.tenantId, body.targetId);
      if (!room) throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
    }
    await repo.insertAllotment(tx, {
      id, tenantId: ctx.tenantId, targetType: body.targetType, targetId: body.targetId,
      employeeRef: body.employeeRef ?? null, orgUnit: body.orgUnit ?? null,
      purpose: body.purpose ?? null, status: "requested",
      requestedBy: ctx.actorId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "allotment_requested", "space_allotment", id);
  });
  return { id };
}

export async function allot(ctx: RequestContext, allotmentId: string, body: AllotBody): Promise<Created> {
  try {
    await repo.scopedTx(ctx.tenantId, async (tx) => {
      const a = await repo.findAllotmentById(tx, ctx.tenantId, allotmentId);
      if (!a) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "allotment not found");
      if (a.version !== body.version) throw new HttpError(409, "VERSION_CONFLICT", "stale version");
      assertValidAllotmentTransition(a.status, "allotted");
      assertMakerChecker(a.requestedBy, ctx.actorId);
      if (a.targetType === "seat") {
        const active = (await repo.findActiveSeatAllotments(tx, ctx.tenantId, a.targetId))
          .filter((x) => x.id !== allotmentId);
        assertSeatAllottable(active);
      } else {
        // Room allotments are capacity-bounded: at most `capacity` concurrent
        // active allotments per room (mirrors the seat single-active guard).
        const room = await repo.findRoomById(tx, ctx.tenantId, a.targetId);
        if (!room) throw new HttpError(404, "ROOM_NOT_FOUND", "room not found");
        const activeCount = (await repo.findActiveRoomAllotments(tx, ctx.tenantId, a.targetId))
          .filter((x) => x.id !== allotmentId).length;
        assertRoomHasCapacity(activeCount, room.capacity);
      }
      // Commit the versioned state change FIRST and confirm it matched a row —
      // a lost update (0 rows) must abort before seat status / event side effects.
      const updated = await repo.updateAllotment(tx, allotmentId, body.version, {
        status: "allotted", allottedBy: ctx.actorId, allottedAt: new Date(),
        licenceFeeMinor: BigInt(body.licenceFeeMinor), currency: body.currency,
        updatedBy: ctx.actorId, version: body.version + 1,
      });
      assertRowUpdated(updated);
      if (a.targetType === "seat") {
        await repo.updateSeatStatus(tx, a.targetId, seatStatusOnAllot(), ctx.actorId);
      }
      await enqueue(tx, {
        topic: EVENTS.spaceSeatAllotted, eventType: EVENTS.spaceSeatAllotted,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          allotmentId, targetType: a.targetType, targetId: a.targetId,
          employeeRef: a.employeeRef, orgUnit: a.orgUnit,
          licenceFeeMinor: body.licenceFeeMinor, currency: body.currency,
        },
      });
      await audit(tx, ctx, "allotment_allotted", "space_allotment", allotmentId);
    });
  } catch (err) { toHttp(err); }
  await cache.invalidate(cache.makeKey(ctx.tenantId, "space_allotment", allotmentId));
  return { id: allotmentId };
}

export async function occupy(ctx: RequestContext, allotmentId: string, body: VersionBody): Promise<Created> {
  try {
    await repo.scopedTx(ctx.tenantId, async (tx) => {
      const a = await repo.findAllotmentById(tx, ctx.tenantId, allotmentId);
      if (!a) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "allotment not found");
      if (a.version !== body.version) throw new HttpError(409, "VERSION_CONFLICT", "stale version");
      assertValidAllotmentTransition(a.status, "occupied");
      const updated = await repo.updateAllotment(tx, allotmentId, body.version, {
        status: "occupied", occupiedAt: new Date(), updatedBy: ctx.actorId, version: body.version + 1,
      });
      assertRowUpdated(updated);
      await audit(tx, ctx, "allotment_occupied", "space_allotment", allotmentId);
    });
  } catch (err) { toHttp(err); }
  return { id: allotmentId };
}

export async function release(ctx: RequestContext, allotmentId: string, body: ReleaseBody): Promise<Created> {
  try {
    await repo.scopedTx(ctx.tenantId, async (tx) => {
      const a = await repo.findAllotmentById(tx, ctx.tenantId, allotmentId);
      if (!a) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "allotment not found");
      if (a.version !== body.version) throw new HttpError(409, "VERSION_CONFLICT", "stale version");
      assertValidAllotmentTransition(a.status, "released");
      const updated = await repo.updateAllotment(tx, allotmentId, body.version, {
        status: "released", releasedAt: new Date(), releaseReason: body.reason ?? null,
        updatedBy: ctx.actorId, version: body.version + 1,
      });
      assertRowUpdated(updated);
      if (a.targetType === "seat") {
        await repo.updateSeatStatus(tx, a.targetId, seatStatusOnRelease(), ctx.actorId);
      }
      await enqueue(tx, {
        topic: EVENTS.spaceSeatReleased, eventType: EVENTS.spaceSeatReleased,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { allotmentId, targetType: a.targetType, targetId: a.targetId, employeeRef: a.employeeRef },
      });
      await audit(tx, ctx, "allotment_released", "space_allotment", allotmentId);
    });
  } catch (err) { toHttp(err); }
  await cache.invalidate(cache.makeKey(ctx.tenantId, "space_allotment", allotmentId));
  return { id: allotmentId };
}

export async function cancelAllotment(ctx: RequestContext, allotmentId: string, body: CancelBody): Promise<Created> {
  try {
    await repo.scopedTx(ctx.tenantId, async (tx) => {
      const a = await repo.findAllotmentById(tx, ctx.tenantId, allotmentId);
      if (!a) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "allotment not found");
      if (a.version !== body.version) throw new HttpError(409, "VERSION_CONFLICT", "stale version");
      assertValidAllotmentTransition(a.status, "cancelled");
      const wasAllotted = a.status === "allotted";
      const updated = await repo.updateAllotment(tx, allotmentId, body.version, {
        status: "cancelled", cancelledAt: new Date(), cancelReason: body.reason ?? null,
        updatedBy: ctx.actorId, version: body.version + 1,
      });
      assertRowUpdated(updated);
      if (wasAllotted && a.targetType === "seat") {
        await repo.updateSeatStatus(tx, a.targetId, seatStatusOnRelease(), ctx.actorId);
      }
      await audit(tx, ctx, "allotment_cancelled", "space_allotment", allotmentId);
    });
  } catch (err) { toHttp(err); }
  return { id: allotmentId };
}

// ── Maintenance ──────────────────────────────────────────────────────────────
export async function createMaintenance(ctx: RequestContext, body: CreateMaintenanceBody, id: string = randomUUID()): Promise<Created> {
  await repo.scopedTx(ctx.tenantId, async (tx) => {
    await repo.insertMaintenance(tx, {
      id, tenantId: ctx.tenantId, assetType: body.assetType, assetId: body.assetId,
      category: body.category, priority: body.priority, description: body.description,
      status: "open", reportedBy: ctx.actorId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.spaceMaintenanceRaised, eventType: EVENTS.spaceMaintenanceRaised,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { maintenanceId: id, assetType: body.assetType, assetId: body.assetId, priority: body.priority },
    });
    await audit(tx, ctx, "maintenance_raised", "maintenance_request", id);
  });
  return { id };
}

export async function updateMaintenanceStatus(
  ctx: RequestContext, id: string, body: MaintenanceStatusBody,
): Promise<Created> {
  try {
    await repo.scopedTx(ctx.tenantId, async (tx) => {
      const patch: Record<string, unknown> = {
        status: body.status, assignedTo: body.assignedTo ?? undefined,
        resolutionNotes: body.resolutionNotes ?? undefined, updatedBy: ctx.actorId, version: body.version + 1,
      };
      if (body.status === "resolved" || body.status === "closed") patch.resolvedAt = new Date();
      const updated = await repo.updateMaintenance(tx, id, body.version, patch);
      assertRowUpdated(updated);
      await audit(tx, ctx, "maintenance_status_" + body.status, "maintenance_request", id);
    });
  } catch (err) { toHttp(err); }
  return { id };
}
