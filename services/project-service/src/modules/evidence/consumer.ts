import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import * as projectRepo from "../project/repo.js";

const log = pino({ name: "project.evidence.consumer" });
const AUDIT = "audit.event.record";

export function registerEvidenceConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.evidenceAttach, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; milestoneId: string;
      fileName: string; fileUrl: string; fileType: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TX-001 — findMilestoneById() opens its own bare db.transaction();
      // called from inside this already-open consumer transaction, that
      // nested call has no free pool connection under pool.max concurrent
      // in-flight consumers and deadlocks the pool silently. Route through
      // the existing findMilestoneByIdTx(tx, ...) sibling instead.
      const milestone = await projectRepo.findMilestoneByIdTx(tx, p.milestoneId, p.tenantId);
      if (!milestone) return;
      await repo.insertTx(tx, {
        id: p.id,
        tenantId: p.tenantId,
        milestoneId: p.milestoneId,
        fileKey: p.fileUrl,
        fileName: p.fileName,
        uploadedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "project", action: "evidence_attach",
          resourceType: "milestone_evidence", resourceId: p.id, outcome: "success",
        },
      });
    });
    log.info({ id: p.id }, "evidence attached");
  });
}
