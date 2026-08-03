// @ts-nocheck — F3 residual spaces consumer
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as apply from "./apply.js";
import type {
  CreateBuildingBody, CreateFloorBody, CreateRoomBody, CreateSeatBody,
  RequestAllotmentBody, AllotBody, VersionBody, ReleaseBody, CancelBody,
  CreateMaintenanceBody, MaintenanceStatusBody,
} from "./validators.js";

const log = pino({ name: "estab-spaces-consumer" });

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };

function ctxOf(msg: Msg) {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    roles: [] as string[],
  };
}

async function once(msg: Msg, run: () => Promise<unknown>): Promise<void> {
  let ok = false;
  await db.transaction(async (tx) => { ok = await markProcessed(tx, msg.messageId); });
  if (!ok) return;
  await run();
}

export function registerSpacesConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.spaceBuildingCreate, async (msg) => {
    const p = msg.payload as CreateBuildingBody & { id: string };
    try {
      await once(msg, () => apply.createBuilding(ctxOf(msg) as never, p, p.id));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceBuildingCreate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceFloorCreate, async (msg) => {
    const p = msg.payload as CreateFloorBody & { id: string };
    try {
      await once(msg, () => apply.createFloor(ctxOf(msg) as never, p, p.id));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceFloorCreate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceRoomCreate, async (msg) => {
    const p = msg.payload as CreateRoomBody & { id: string };
    try {
      await once(msg, () => apply.createRoom(ctxOf(msg) as never, p, p.id));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceRoomCreate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceSeatCreate, async (msg) => {
    const p = msg.payload as CreateSeatBody & { id: string };
    try {
      await once(msg, () => apply.createSeat(ctxOf(msg) as never, p, p.id));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceSeatCreate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceAllotmentRequest, async (msg) => {
    const p = msg.payload as RequestAllotmentBody & { id: string };
    try {
      await once(msg, () => apply.requestAllotment(ctxOf(msg) as never, p, p.id));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceAllotmentRequest failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceAllotmentAllot, async (msg) => {
    const p = msg.payload as AllotBody & { id: string };
    try {
      await once(msg, () => apply.allot(ctxOf(msg) as never, p.id, p));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceAllotmentAllot failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceAllotmentOccupy, async (msg) => {
    const p = msg.payload as VersionBody & { id: string };
    try {
      await once(msg, () => apply.occupy(ctxOf(msg) as never, p.id, p));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceAllotmentOccupy failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceAllotmentRelease, async (msg) => {
    const p = msg.payload as ReleaseBody & { id: string };
    try {
      await once(msg, () => apply.release(ctxOf(msg) as never, p.id, p));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceAllotmentRelease failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceAllotmentCancel, async (msg) => {
    const p = msg.payload as CancelBody & { id: string };
    try {
      await once(msg, () => apply.cancelAllotment(ctxOf(msg) as never, p.id, p));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceAllotmentCancel failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceMaintenanceCreate, async (msg) => {
    const p = msg.payload as CreateMaintenanceBody & { id: string };
    try {
      await once(msg, () => apply.createMaintenance(ctxOf(msg) as never, p, p.id));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceMaintenanceCreate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.spaceMaintenanceStatus, async (msg) => {
    const p = msg.payload as MaintenanceStatusBody & { id: string };
    try {
      await once(msg, () => apply.updateMaintenanceStatus(ctxOf(msg) as never, p.id, p));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spaceMaintenanceStatus failed");
      throw err;
    }
  });
}
