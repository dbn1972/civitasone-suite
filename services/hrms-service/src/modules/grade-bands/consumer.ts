/**
 * S8-G4 consumers: create / update / activate-deactivate / delete a grade band.
 *
 * Every handler is idempotent (markProcessed), runs in one transaction with its audit event, and
 * RE-ASSERTS what the route checked (the world can change between publish and consume). Refusals
 * (duplicate code, band now in use, impossible CTC range) are COMMITTED with a "denied" audit and
 * returned, never thrown: a throw would roll the audit back with the transaction.
 */
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS } from "../../topics.js";
import { hrmsGradeBands } from "../employee/schema.js";
import * as repo from "./repo.js";
import type { GradeBandPayload } from "./commands.js";

const AUDIT = "audit.event.record";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Msg = { tenantId: string; actorId: string; correlationId: string; messageId: string };

async function audit(tx: Tx, msg: Msg, action: string, resourceId: string, outcome: "success" | "denied", metadata: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType: "grade_band", resourceId, outcome, metadata },
  });
}

const big = (v: string | null | undefined): bigint | null | undefined => (v === undefined ? undefined : v === null ? null : BigInt(v));

export function registerGradeBandConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.gradeBandCreate, async (msg) => {
    const p = msg.payload as GradeBandPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const code = String(p.code ?? "");
      if (!code || p.name === undefined || p.rank === undefined) throw new NonRetryableError("grade band create: code, name and rank are required");
      const existing = await repo.findBandByCode(tx, msg.tenantId, code);
      if (existing) { await audit(tx, msg, "create", existing.id, "denied", { code, reason: "DUPLICATE_CODE" }); return; }
      const min = big(p.ctcMinMinor) ?? null, max = big(p.ctcMaxMinor) ?? null;
      if (min !== null && max !== null && min > max) { await audit(tx, msg, "create", p.id, "denied", { code, reason: "CTC_RANGE_INVERTED" }); return; }
      await tx.insert(hrmsGradeBands).values({
        id: p.id, tenantId: msg.tenantId, code, name: p.name, rank: p.rank, track: p.track ?? null,
        ctcMinMinor: min, ctcMaxMinor: max, noticeDays: p.noticeDays ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }).onConflictDoNothing();
      await audit(tx, msg, "create", p.id, "success", { code, name: p.name, rank: p.rank, track: p.track ?? null });
    });
  });

  queue.subscribe(COMMANDS.gradeBandUpdate, async (msg) => {
    const p = msg.payload as { id: string; changes: Omit<GradeBandPayload, "id"> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = await repo.findBand(tx, msg.tenantId, p.id);
      if (!before) throw new NonRetryableError(`grade band ${p.id} not found`);
      const c = p.changes;
      const set: Record<string, unknown> = {};
      if (c.name !== undefined) set.name = c.name;
      if (c.rank !== undefined) set.rank = c.rank;
      if (c.track !== undefined) set.track = c.track;
      if (c.noticeDays !== undefined) set.noticeDays = c.noticeDays;
      if (c.ctcMinMinor !== undefined) set.ctcMinMinor = big(c.ctcMinMinor);
      if (c.ctcMaxMinor !== undefined) set.ctcMaxMinor = big(c.ctcMaxMinor);
      const min = (set.ctcMinMinor !== undefined ? set.ctcMinMinor : before.ctcMinMinor) as bigint | null;
      const max = (set.ctcMaxMinor !== undefined ? set.ctcMaxMinor : before.ctcMaxMinor) as bigint | null;
      if (min !== null && max !== null && min > max) { await audit(tx, msg, "update", p.id, "denied", { code: before.code, reason: "CTC_RANGE_INVERTED" }); return; }
      await tx.update(hrmsGradeBands)
        .set({ ...set, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${hrmsGradeBands.version} + 1` } as never)
        .where(and(eq(hrmsGradeBands.tenantId, msg.tenantId), eq(hrmsGradeBands.id, p.id)));
      const prior: Record<string, unknown> = {};
      for (const k of Object.keys(set)) prior[k] = String((before as Record<string, unknown>)[k] ?? "");
      await audit(tx, msg, "update", p.id, "success", { code: before.code, before: prior, after: JSON.parse(JSON.stringify(set, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) });
    });
  });

  queue.subscribe(COMMANDS.gradeBandSetActive, async (msg) => {
    const p = msg.payload as { id: string; isActive: boolean };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = await repo.findBand(tx, msg.tenantId, p.id);
      if (!before) throw new NonRetryableError(`grade band ${p.id} not found`);
      if (before.isActive === p.isActive) return;
      await tx.update(hrmsGradeBands)
        .set({ isActive: p.isActive, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${hrmsGradeBands.version} + 1` })
        .where(and(eq(hrmsGradeBands.tenantId, msg.tenantId), eq(hrmsGradeBands.id, p.id)));
      await audit(tx, msg, p.isActive ? "reactivate" : "deactivate", p.id, "success", { code: before.code });
    });
  });

  queue.subscribe(COMMANDS.gradeBandDelete, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = await repo.findBand(tx, msg.tenantId, p.id);
      if (!before) return; // already gone: idempotent
      const used = await repo.countDesignationsOnBand(tx, msg.tenantId, p.id);
      if (used > 0) { await audit(tx, msg, "delete", p.id, "denied", { code: before.code, reason: "BAND_IN_USE", designations: used }); return; }
      await tx.delete(hrmsGradeBands).where(and(eq(hrmsGradeBands.tenantId, msg.tenantId), eq(hrmsGradeBands.id, p.id)));
      await audit(tx, msg, "delete", p.id, "success", { code: before.code });
    });
  });
}
