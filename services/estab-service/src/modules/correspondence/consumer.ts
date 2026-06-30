import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { nextPageRange, nextCorrNo } from "./domain.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Command topics for the correspondence module. Defined locally (not imported
 * from ../../topics.ts) so this module stays self-contained. Must match the
 * COMMANDS object in commands.ts.
 */
const COMMANDS = {
  correspondenceAdd: "estab.correspondence.add",
  pucMark:           "estab.file.puc.mark",
  pucUnmark:         "estab.file.puc.unmark",
} as const;

export function registerCorrespondenceConsumers(queue: Queue): void {
  // ── Add correspondence (running, append-only, STABLE page numbering) ─────
  queue.subscribe(COMMANDS.correspondenceAdd, async (msg) => {
    const p = msg.payload as {
      id: string; fileId: string; tenantId: string;
      direction: string; party: string; subject: string;
      letterRef?: string; letterDate?: string; numPages?: number;
      storageRef?: string; isOfficeCopy?: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Read the current high-water page + count INSIDE the tx so the running
      // sequence is assigned atomically (single consumer ⇒ no interleave).
      const currentMax = await repo.maxPageTo(tx, p.fileId, p.tenantId);
      const count = await repo.countCorrespondence(tx, p.fileId, p.tenantId);
      const { pageFrom, pageTo } = nextPageRange(currentMax, p.numPages ?? 1);
      const corrNo = nextCorrNo(count);
      await repo.insertCorrespondence(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId,
        corrNo, direction: p.direction,
        letterRef: p.letterRef ?? null,
        letterDate: p.letterDate ?? null,
        party: p.party, subject: p.subject,
        pageFrom, pageTo,
        storageRef: p.storageRef ?? null,
        isOfficeCopy: p.isOfficeCopy ?? false,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "add_correspondence", "correspondence", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  // ── Mark PUC (multiple active PUCs allowed) ──────────────────────────────
  queue.subscribe(COMMANDS.pucMark, async (msg) => {
    const p = msg.payload as { id: string; fileId: string; tenantId: string; correspondenceId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Guard: the referenced correspondence must exist on this file/tenant.
      const corr = await repo.findCorrespondenceById(p.correspondenceId, p.tenantId);
      if (!corr || corr.fileId !== p.fileId) {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "estab", action: "mark_puc_rejected_unknown", resourceType: "correspondence", resourceId: p.correspondenceId, outcome: "rejected" },
        });
        return;
      }
      await repo.insertPuc(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId,
        correspondenceId: p.correspondenceId, markedBy: msg.actorId,
        active: true,
      });
      await audit(tx, msg, "mark_puc", "file_puc", p.correspondenceId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  // ── Unmark PUC (set active = false) ──────────────────────────────────────
  queue.subscribe(COMMANDS.pucUnmark, async (msg) => {
    const p = msg.payload as { id: string; fileId: string; tenantId: string; correspondenceId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.deactivatePuc(tx, p.fileId, p.tenantId, p.correspondenceId);
      await audit(tx, msg, "unmark_puc", "file_puc", p.correspondenceId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
