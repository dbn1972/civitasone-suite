import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as configRepo from "../config-registry/repo.js";
import { DEFAULT_COURT_TYPES, assertCourtTypeAllowed } from "./domain.js";

type CreateCourtPayload = {
  id: string;
  tenantId: string;
  name: string;
  courtType: string;
  jurisdiction?: string;
  establishmentCode?: string;
  parentCourtId?: string;
  address?: string;
};

type CreateBenchPayload = {
  id: string;
  courtId: string;
  tenantId: string;
  name: string;
  presidingJudgeId?: string;
  benchType?: string;
};

/**
 * court-registry consumers. Each handler runs in ONE tenant-scoped tx that sets
 * the RLS GUC (see shared/db.ts), begins with a markProcessed inbox-dedup gate
 * (redelivery = no-op), writes the domain row, and enqueues its event + an audit
 * record in the SAME tx — so "DB committed ⇒ event delivered", exactly once.
 */
export function registerCourtRegistryConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  register<CreateCourtPayload>(COMMANDS.createCourt, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // §47 config/metadata: courtType must be in (defaults ∪ tenant config).
      const configured = await configRepo.listActiveKeys(tx, p.tenantId, "court_type");
      const allowedTypes = new Set<string>([...DEFAULT_COURT_TYPES, ...configured]);
      try {
        assertCourtTypeAllowed(p.courtType, allowedTypes);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }
      await repo.insertCourt(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        courtType: p.courtType,
        jurisdiction: p.jurisdiction ?? null,
        establishmentCode: p.establishmentCode ?? null,
        parentCourtId: p.parentCourtId ?? null,
        address: p.address ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.courtRegistered,
        eventType: EVENTS.courtRegistered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { courtId: p.id, courtType: p.courtType, name: p.name },
      });
      await audit(tx, msg, "create", "court", p.id);
    });
  });

  register<CreateBenchPayload>(COMMANDS.createBench, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertBench(tx, {
        id: p.id,
        tenantId: p.tenantId,
        courtId: p.courtId,
        name: p.name,
        presidingJudgeId: p.presidingJudgeId ?? null,
        benchType: p.benchType ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.benchRegistered,
        eventType: EVENTS.benchRegistered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { benchId: p.id, courtId: p.courtId, name: p.name },
      });
      await audit(tx, msg, "create", "court_bench", p.id);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
