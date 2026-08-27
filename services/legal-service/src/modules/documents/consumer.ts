import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { validateFolderDepth, assertCanDelete, assertCanModifyContent, computeDepth } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

// queries.ts's listDocuments() reads through a "documents" list key scoped
// to matterId:parentFolderId — the same stale-list-cache bug found and fixed
// for counsel-briefs (fix/legal-wire-real-counsel-brief-endpoint), confirmed
// live there via POST-then-immediate-GET. Unlike that fix, the exact list
// key is always derivable here (from the write's own payload, or from the
// document row loaded to authorize the write), so every handler below
// invalidates that one folder's key precisely instead of every folder's
// cached listing in the tenant.
async function invalidateDocumentAndFolder(
  tenantId: string,
  documentId: string,
  folder: { matterId: string; parentFolderId: string | null } | undefined,
  extraKeys: string[] = [],
): Promise<void> {
  const invalidations = [
    cache.invalidate(cache.makeKey(tenantId, "document", documentId)),
    ...extraKeys.map((resource) => cache.invalidate(cache.makeKey(tenantId, resource, documentId))),
  ];
  // folder is undefined only when the write was a no-op (redelivered/
  // already-processed message, or the document lookup never ran) — nothing
  // changed, so there is nothing to invalidate for the folder listing.
  if (folder) {
    invalidations.push(
      cache.invalidate(cache.makeKey(tenantId, "documents", `${folder.matterId}:${folder.parentFolderId ?? "root"}`)),
    );
  }
  await Promise.all(invalidations);
}

export function registerDocumentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.documentCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; matterId: string;
      parentFolderId?: string; name: string; type: "folder" | "file";
      body?: string; fileKey?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      let parentDepth: number | null = null;
      if (p.parentFolderId) {
        const parent = await repo.findDocumentByIdTx(tx, p.parentFolderId);
        if (!parent) throw new Error(`parent folder ${p.parentFolderId} not found`);
        if (parent.type !== "folder") throw new Error(`parent ${p.parentFolderId} is not a folder`);
        parentDepth = parent.depth;
        // Validate depth constraint for folders
        if (p.type === "folder") {
          validateFolderDepth(parentDepth);
        }
      }

      const depth = computeDepth(parentDepth);

      await repo.insertDocument(tx, {
        id: p.id,
        tenantId: p.tenantId,
        matterId: p.matterId,
        parentFolderId: p.parentFolderId ?? null,
        name: p.name,
        type: p.type,
        body: p.body ?? null,
        fileKey: p.fileKey ?? null,
        version: 1,
        legalHold: false,
        depth,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // If it's a file with content, create initial version record
      if (p.type === "file" && (p.body || p.fileKey)) {
        await repo.insertVersion(tx, {
          tenantId: p.tenantId,
          documentId: p.id,
          versionNumber: 1,
          body: p.body ?? null,
          fileKey: p.fileKey ?? null,
          createdBy: msg.actorId,
        });
      }

      await audit(tx, msg, "create", "document", p.id);
    });

    await invalidateDocumentAndFolder(msg.tenantId, p.id, { matterId: p.matterId, parentFolderId: p.parentFolderId ?? null });
  });

  queue.subscribe(COMMANDS.documentUpdate, async (msg) => {
    const p = msg.payload as {
      documentId: string; tenantId: string;
      name?: string; body?: string; fileKey?: string;
    };

    let updatedDoc: { matterId: string; parentFolderId: string | null } | undefined;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const doc = await repo.findDocumentByIdTx(tx, p.documentId);
      if (!doc) throw new Error(`document ${p.documentId} not found`);
      updatedDoc = { matterId: doc.matterId, parentFolderId: doc.parentFolderId };

      const isContentUpdate = p.body !== undefined || p.fileKey !== undefined;
      if (isContentUpdate) {
        assertCanModifyContent(doc.legalHold);
      }

      const newVersion = isContentUpdate ? doc.version + 1 : doc.version;

      // Save current version to history before updating (only for content changes)
      if (isContentUpdate) {
        await repo.insertVersion(tx, {
          tenantId: doc.tenantId,
          documentId: doc.id,
          versionNumber: doc.version,
          body: doc.body,
          fileKey: doc.fileKey,
          createdBy: doc.updatedBy,
        });
      }

      const patch: Record<string, unknown> = { updatedBy: msg.actorId, version: newVersion };
      if (p.name !== undefined) patch.name = p.name;
      if (p.body !== undefined) patch.body = p.body;
      if (p.fileKey !== undefined) patch.fileKey = p.fileKey;

      await repo.updateDocument(tx, p.documentId, patch);
      await audit(tx, msg, "update", "document", p.documentId);
    });

    // This path never moves a document between folders, so the loaded
    // matterId/parentFolderId are also the post-update ones.
    await invalidateDocumentAndFolder(msg.tenantId, p.documentId, updatedDoc, ["doc-versions"]);
  });

  queue.subscribe(COMMANDS.documentDelete, async (msg) => {
    const p = msg.payload as { documentId: string; tenantId: string };

    let deletedDoc: { matterId: string; parentFolderId: string | null } | undefined;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const doc = await repo.findDocumentByIdTx(tx, p.documentId);
      if (!doc) throw new Error(`document ${p.documentId} not found`);
      deletedDoc = { matterId: doc.matterId, parentFolderId: doc.parentFolderId };

      assertCanDelete(doc.legalHold);

      await repo.deleteDocument(tx, p.documentId);
      await audit(tx, msg, "delete", "document", p.documentId);
    });

    // A delete removes an entry from listDocuments()'s cached folder listing
    // — without invalidating it, a just-deleted document would keep
    // appearing in that folder's list until the cache TTL expires.
    await invalidateDocumentAndFolder(msg.tenantId, p.documentId, deletedDoc);
  });

  queue.subscribe(COMMANDS.documentHoldApply, async (msg) => {
    const p = msg.payload as { documentId: string; tenantId: string };

    let heldDoc: { matterId: string; parentFolderId: string | null } | undefined;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const doc = await repo.findDocumentByIdTx(tx, p.documentId);
      if (!doc) throw new Error(`document ${p.documentId} not found`);
      heldDoc = { matterId: doc.matterId, parentFolderId: doc.parentFolderId };

      await repo.setLegalHold(tx, p.documentId, true);
      await audit(tx, msg, "hold_apply", "document", p.documentId);
    });

    await invalidateDocumentAndFolder(msg.tenantId, p.documentId, heldDoc);
  });

  queue.subscribe(COMMANDS.documentHoldRelease, async (msg) => {
    const p = msg.payload as { documentId: string; tenantId: string };

    let releasedDoc: { matterId: string; parentFolderId: string | null } | undefined;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const doc = await repo.findDocumentByIdTx(tx, p.documentId);
      if (!doc) throw new Error(`document ${p.documentId} not found`);
      releasedDoc = { matterId: doc.matterId, parentFolderId: doc.parentFolderId };

      await repo.setLegalHold(tx, p.documentId, false);
      await audit(tx, msg, "hold_release", "document", p.documentId);
    });

    await invalidateDocumentAndFolder(msg.tenantId, p.documentId, releasedDoc);
  });
}

async function audit(
  tx: any,
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
