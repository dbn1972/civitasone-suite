import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as tenderRepo from "./repo.js";
import * as docsRepo from "./docs-repo.js";
import {
  nextSeq, nextDocVersion, assertPrebidTransition, assertRepublishable, assertTenderAmendable,
} from "./docs-domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerTenderDocsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.tenderDocAdd, async (msg) => {
    const p = msg.payload as {
      id: string; tenderId: string; tenantId: string; docType: string;
      title: string; storageRef: string; mimeType?: string; sizeBytes?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Supersede-versioning: retire the current doc of this type, if any.
      const current = await docsRepo.findCurrentDocTx(tx, p.tenderId, p.tenantId, p.docType);
      if (current) {
        await docsRepo.updateDoc(tx, current.id, { isCurrent: false, updatedBy: msg.actorId, version: (current.version ?? 1) + 1 });
      }
      await docsRepo.insertDoc(tx, {
        id: p.id, tenderId: p.tenderId, tenantId: p.tenantId, docType: p.docType,
        title: p.title, storageRef: p.storageRef,
        mimeType: p.mimeType ?? null, sizeBytes: p.sizeBytes != null ? BigInt(p.sizeBytes) : null,
        docVersion: nextDocVersion(current?.docVersion), isCurrent: true,
        supersedesId: current?.id ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "add", "procurement_tender_document", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "tender", p.tenderId));
  });

  queue.subscribe(COMMANDS.tenderCorrigendumCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenderId: string; tenantId: string; title: string;
      description?: string; storageRef?: string; newBidClosingDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const tender = await tenderRepo.findTenderByIdTx(tx, p.tenderId, p.tenantId);
      if (!tender) throw new Error(`tender ${p.tenderId} not found`);
      assertTenderAmendable(tender.status);
      const corrigendumNo = nextSeq(await docsRepo.maxCorrigendumNoTx(tx, p.tenderId, p.tenantId));
      await docsRepo.insertCorrigendum(tx, {
        id: p.id, tenderId: p.tenderId, tenantId: p.tenantId, corrigendumNo,
        title: p.title, description: p.description ?? null, storageRef: p.storageRef ?? null,
        newBidClosingDate: p.newBidClosingDate ?? null, isCurrent: true, republished: false,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "procurement_tender_corrigendum", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "tender", p.tenderId));
  });

  queue.subscribe(COMMANDS.tenderCorrigendumRepublish, async (msg) => {
    const p = msg.payload as { tenderId: string; corrigendumId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const corr = await docsRepo.findCorrigendumByIdTx(tx, p.corrigendumId, p.tenantId);
      if (!corr || corr.tenderId !== p.tenderId) throw new Error(`corrigendum ${p.corrigendumId} not found`);
      assertRepublishable(corr.republished);
      await docsRepo.updateCorrigendum(tx, p.corrigendumId, {
        republished: true, publishedAt: new Date(), updatedBy: msg.actorId, version: (corr.version ?? 1) + 1,
      });
      // A corrigendum with a new bid-closing date extends the live tender.
      const tender = await tenderRepo.findTenderByIdTx(tx, p.tenderId, p.tenantId);
      if (tender && corr.newBidClosingDate) {
        await tenderRepo.updateTenderVersioned(tx, p.tenderId, tender.version ?? 1, {
          bidClosingDate: corr.newBidClosingDate, updatedBy: msg.actorId,
        });
      }
      await enqueue(tx, {
        topic: EVENTS.tenderCorrigendumPublished, eventType: EVENTS.tenderCorrigendumPublished,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          tenderId: p.tenderId, tenantId: p.tenantId, corrigendumId: p.corrigendumId,
          corrigendumNo: corr.corrigendumNo, newBidClosingDate: corr.newBidClosingDate ?? null,
        },
      });
      await audit(tx, msg, "republish", "procurement_tender_corrigendum", p.corrigendumId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "tender", p.tenderId));
  });

  queue.subscribe(COMMANDS.prebidQueryCreate, async (msg) => {
    const p = msg.payload as { id: string; tenderId: string; tenantId: string; question: string; vendorId?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const queryNo = nextSeq(await docsRepo.maxQueryNoTx(tx, p.tenderId, p.tenantId));
      await docsRepo.insertPrebidQuery(tx, {
        id: p.id, tenderId: p.tenderId, tenantId: p.tenantId, vendorId: p.vendorId ?? null,
        queryNo, question: p.question, status: "open", published: false,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "procurement_prebid_query", p.id);
    });
  });

  queue.subscribe(COMMANDS.prebidQueryAnswer, async (msg) => {
    const p = msg.payload as { tenderId: string; queryId: string; tenantId: string; answer: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const q = await docsRepo.findPrebidQueryByIdTx(tx, p.queryId, p.tenantId);
      if (!q || q.tenderId !== p.tenderId) throw new Error(`pre-bid query ${p.queryId} not found`);
      assertPrebidTransition(q.status, "answered");
      await docsRepo.updatePrebidQuery(tx, p.queryId, {
        answer: p.answer, status: "answered", answeredBy: msg.actorId, answeredAt: new Date(),
        updatedBy: msg.actorId, version: (q.version ?? 1) + 1,
      });
      await audit(tx, msg, "answer", "procurement_prebid_query", p.queryId);
    });
  });

  queue.subscribe(COMMANDS.prebidQueryPublish, async (msg) => {
    const p = msg.payload as { tenderId: string; queryId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const q = await docsRepo.findPrebidQueryByIdTx(tx, p.queryId, p.tenantId);
      if (!q || q.tenderId !== p.tenderId) throw new Error(`pre-bid query ${p.queryId} not found`);
      assertPrebidTransition(q.status, "published");
      await docsRepo.updatePrebidQuery(tx, p.queryId, {
        status: "published", published: true, updatedBy: msg.actorId, version: (q.version ?? 1) + 1,
      });
      await audit(tx, msg, "publish", "procurement_prebid_query", p.queryId);
    });
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
