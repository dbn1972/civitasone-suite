import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "loyalty.programs.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

function invalidateProgram(tenantId: string, id: string): Promise<void> {
  return cache.invalidate(cache.makeKey(tenantId, "program", id));
}

export function registerProgramConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createProgram, async (msg) => {
    const p = msg.payload as {
      id: string;
      name: string;
      earnRatio: number;
      expiryDays: number | null;
      tierConfig: Record<string, unknown>;
      status: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        status: p.status,
        earnRatio: BigInt(p.earnRatio),
        expiryDays: p.expiryDays,
        tierConfig: p.tierConfig ?? {},
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.programCreated,
        eventType: EVENTS.programCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { programId: p.id, name: p.name },
      });
      await writeAudit(tx, ctxOf(msg), { action: "program.create", resourceType: "loyalty_program", resourceId: p.id });
    });
    log.info({ id: p.id }, "program created");
  });

  queue.subscribe(COMMANDS.updateProgram, async (msg) => {
    const p = msg.payload as { id: string; version: number; patch: Record<string, unknown> };
    const patch = { ...p.patch };
    if (typeof patch.earnRatio === "number" || typeof patch.earnRatio === "string") {
      patch.earnRatio = BigInt(patch.earnRatio as number | string);
    }
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, patch, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.programUpdated,
        eventType: EVENTS.programUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { programId: p.id, fields: Object.keys(p.patch) },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "program.update",
        resourceType: "loyalty_program",
        resourceId: p.id,
        details: { fields: Object.keys(p.patch) },
      });
    });
    if (applied) await invalidateProgram(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.transitionProgram, async (msg) => {
    const p = msg.payload as { id: string; status: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: p.status, updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.programTransitioned,
        eventType: EVENTS.programTransitioned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { programId: p.id, status: p.status },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "program.transition",
        resourceType: "loyalty_program",
        resourceId: p.id,
        details: { status: p.status },
      });
    });
    if (applied) await invalidateProgram(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.archiveProgram, async (msg) => {
    const p = msg.payload as { id: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "archived", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.programArchived,
        eventType: EVENTS.programArchived,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { programId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "program.archive", resourceType: "loyalty_program", resourceId: p.id });
    });
    if (applied) await invalidateProgram(msg.tenantId, p.id);
  });
}
