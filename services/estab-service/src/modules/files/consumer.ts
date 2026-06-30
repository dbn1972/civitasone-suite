import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import { computeFileDueBy, computeNotingHash, deriveChildFileNo, assertValidFileType } from "./domain.js";
import * as repo from "./repo.js";
import * as recordsRepo from "../records/repo.js";
import { emitModuleDecisionCallback } from "../linkage/consumer.js";

const AUDIT_TOPIC = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";
const FILE_NOTING_WORKFLOW = "file_noting";
const WORKFLOW_TASK_COMPLETED = "estab.file.level_approved";

/**
 * Green-sign a noting with the tamper-evident hash chain (shared by the manual
 * sign endpoint and the workflow auto-sign on each level's approval).
 * No-op if the noting is already signed/approved (idempotent; the DB trigger
 * also enforces immutability).
 */
async function signNotingChain(
  tx: Parameters<typeof enqueue>[0],
  opts: { tenantId: string; fileId: string; notingId: string; body: string; officerId: string },
): Promise<{ notingId: string; dscHash: string; signatureRef: string; chainSeq: number }> {
  const prevRows = await tx.execute(sql`
    SELECT dsc_hash, chain_seq
    FROM files.estab_notings
    WHERE tenant_id = ${opts.tenantId} AND file_id = ${opts.fileId}
      AND note_type = 'green' AND chain_seq IS NOT NULL
    ORDER BY chain_seq DESC
    LIMIT 1
  `);
  const prev = (prevRows as unknown as Array<{ dsc_hash: string | null; chain_seq: number | null }>)[0];
  const prevHash = prev?.dsc_hash ?? "";
  const chainSeq = (prev?.chain_seq ?? 0) + 1;

  const signedAtMs = Date.now();
  const signatureRef = `DSC-${opts.officerId.slice(0, 8)}-${signedAtMs}`;
  const dscHash = computeNotingHash(opts.notingId, opts.body, opts.officerId, prevHash, signedAtMs);

  await tx.execute(sql`
    UPDATE files.estab_notings
    SET note_type = 'green', note_status = 'approved', e_signed = true,
        signed_at = to_timestamp(${signedAtMs}::double precision / 1000.0),
        signature_ref = ${signatureRef}, dsc_hash = ${dscHash},
        prev_hash = ${prevHash === "" ? null : prevHash}, chain_seq = ${chainSeq},
        updated_by = ${opts.officerId},
        updated_at = to_timestamp(${signedAtMs}::double precision / 1000.0)
    WHERE id = ${opts.notingId} AND tenant_id = ${opts.tenantId}
  `);
  return { notingId: opts.notingId, dscHash, signatureRef, chainSeq };
}

export function registerFilesConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.fileCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; fileNo: string; subject: string; dept: string;
      priority: string; classification: string; currentWith: string; section?: string;
      initialNote?: string; inwardId?: string; dakNo?: string; parentFileId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const dueBy = computeFileDueBy();
      // CSMOP gapless file number per section+year (legacy fileNo honoured if given).
      const fileNo = p.fileNo ?? await repo.allocateFileNo(tx, p.tenantId, p.section ?? p.dept, new Date().getFullYear());
      await repo.insertFile(tx, {
        id: p.id, tenantId: p.tenantId, fileNo, subject: p.subject,
        dept: p.dept, priority: p.priority, classification: p.classification,
        currentWith: p.currentWith, status: "draft",
        inwardId: p.inwardId ?? null, dakNo: p.dakNo ?? null, dueBy,
        parentFileId: p.parentFileId ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.inwardId) {
        await repo.updateInward(tx, p.inwardId, {
          fileId: p.id, fileRef: fileNo, status: "file_opened", updatedBy: msg.actorId,
        });
      }
      if (p.initialNote?.trim()) {
        const noteId = randomUUID();
        await repo.insertNoting(tx, {
          id: noteId, tenantId: p.tenantId, fileId: p.id, seq: 1,
          officerId: p.currentWith, body: p.initialNote.trim(),
          action: "initiate", noteType: "yellow", noteStatus: "draft",
          eSigned: false, signedAt: null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await enqueue(tx, {
        topic: EVENTS.fileCreated, eventType: EVENTS.fileCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fileId: p.id, fileNo, subject: p.subject, dakNo: p.dakNo },
      });
      await audit(tx, msg, "create", "file", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.id));
  });

  queue.subscribe(COMMANDS.inwardOpenFile, async (msg) => {
    const p = msg.payload as {
      id: string; inwardId: string; tenantId: string; fileNo?: string; section?: string;
      dept: string; currentWith: string; classification: string; initialNote?: string;
    };
    const inward = await repo.findInwardById(p.inwardId, p.tenantId);
    if (!inward) return;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const dueBy = computeFileDueBy();
      const fileNo = p.fileNo ?? await repo.allocateFileNo(tx, p.tenantId, p.section ?? p.dept, new Date().getFullYear());
      await repo.insertFile(tx, {
        id: p.id, tenantId: p.tenantId, fileNo,
        subject: inward.subject, dept: p.dept, priority: "normal",
        classification: p.classification, currentWith: p.currentWith,
        status: "draft", inwardId: p.inwardId, dakNo: inward.dakNo, dueBy,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateInward(tx, p.inwardId, {
        fileId: p.id, fileRef: fileNo, status: "file_opened", updatedBy: msg.actorId,
      });
      const noteBody = p.initialNote?.trim() ?? `DAK ${inward.dakNo} registered and file opened.`;
      await repo.insertNoting(tx, {
        id: randomUUID(), tenantId: p.tenantId, fileId: p.id, seq: 1,
        officerId: p.currentWith, body: noteBody,
        action: "dak_to_file", noteType: "yellow", noteStatus: "draft",
        eSigned: false, signedAt: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.fileCreated, eventType: EVENTS.fileCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fileId: p.id, fileNo: p.fileNo, inwardId: p.inwardId, dakNo: inward.dakNo },
      });
      await audit(tx, msg, "open_from_dak", "file", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.id));
  });

  queue.subscribe(COMMANDS.notingAdd, async (msg) => {
    const p = msg.payload as {
      id: string; fileId: string; tenantId: string; body: string;
      action?: string; officerId: string; noteType?: string;
      officerName?: string; officerDesignation?: string; officerSection?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findFileById(p.fileId, p.tenantId);
      if (existing?.status === "closed") {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "estab", action: "noting_rejected_closed_file", resourceType: "file", resourceId: p.fileId, outcome: "rejected" },
        });
        return;
      }
      const seq = (await repo.countNotings(tx, p.fileId)) + 1;
      await repo.insertNoting(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId, seq,
        officerId: p.officerId, body: p.body, action: p.action ?? null,
        noteType: p.noteType ?? "yellow", noteStatus: "draft",
        officerName: p.officerName ?? null,
        officerDesignation: p.officerDesignation ?? null,
        officerSection: p.officerSection ?? null,
        eSigned: false, signedAt: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "add", "noting", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.notingSubmit, async (msg) => {
    const p = msg.payload as { fileId: string; notingId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const noting = await repo.findNotingById(p.notingId, p.tenantId);
      if (!noting || noting.fileId !== p.fileId || noting.noteStatus !== "draft") return;

      await repo.updateNoting(tx, p.notingId, {
        noteStatus: "submitted", updatedBy: msg.actorId,
      });
      await repo.updateFile(tx, p.fileId, { status: "active", updatedBy: msg.actorId });

      const wfId = randomUUID();
      await enqueue(tx, {
        topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: wfId,
          tenantId: msg.tenantId,
          name: `File Noting — ${p.fileId.slice(0, 8)}`,
          status: "active",
          definitionCode: FILE_NOTING_WORKFLOW,
          startNodeKey: "section_review",
          initialTaskName: "Section Officer Review",
          version: 1,
          refType: "estab_file",
          refId: p.fileId,
        },
      });
      await audit(tx, msg, "submit_for_approval", "noting", p.notingId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(CONSUMED_EVENTS.fileApprove, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; approvedBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // R9/R10: capture the noting BEFORE the status flip and green-sign it
      // through the SAME hash chain as the manual/level-approval paths, so the
      // backbone approval accrues prev_hash/chain_seq. We retain the signed
      // notingId + dscHash to bind the decision callback to the e-signed green
      // note (re-querying findLatestSubmittedNoting here would return null since
      // the note is no longer 'submitted').
      const noting = await repo.findLatestSubmittedNoting(tx, p.fileId, p.tenantId);
      let signedNotingId: string | null = null;
      let signedDscHash: string | null = null;
      if (noting) {
        const signed = await signNotingChain(tx, {
          tenantId: p.tenantId, fileId: p.fileId, notingId: noting.id,
          body: noting.body, officerId: p.approvedBy,
        });
        signedNotingId = signed.notingId;
        signedDscHash = signed.dscHash;
      }
      await repo.updateFile(tx, p.fileId, { status: "active", updatedBy: p.approvedBy });
      await enqueue(tx, {
        topic: EVENTS.fileMoved, eventType: EVENTS.fileMoved,
        tenantId: msg.tenantId, actorId: p.approvedBy, correlationId: msg.correlationId,
        payload: { fileId: p.fileId, action: "noting_approved", approvedBy: p.approvedBy },
      });
      // Cross-module: if this file was raised by a source module, send the
      // approved decision back so the module can execute (release budget, etc.)
      // — now carrying the signed green note's id + DSC hash.
      await emitModuleDecisionCallback(tx, {
        tenantId: p.tenantId, fileId: p.fileId, correlationId: msg.correlationId,
        decision: "approved", decidedBy: p.approvedBy,
        notingId: signedNotingId,
        dscHash: signedDscHash,
      });
      await audit(tx, msg, "approve", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(CONSUMED_EVENTS.fileReject, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; rejectedBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const noting = await repo.findLatestSubmittedNoting(tx, p.fileId, p.tenantId);
      if (noting) {
        await repo.updateNoting(tx, noting.id, {
          noteStatus: "rejected",
          updatedBy: p.rejectedBy,
        });
      }
      await repo.updateFile(tx, p.fileId, { status: "draft", updatedBy: p.rejectedBy });
      await enqueue(tx, {
        topic: EVENTS.fileMoved, eventType: EVENTS.fileMoved,
        tenantId: msg.tenantId, actorId: p.rejectedBy, correlationId: msg.correlationId,
        payload: { fileId: p.fileId, action: "noting_rejected", rejectedBy: p.rejectedBy },
      });
      // Cross-module: send the rejected decision back to the source module
      await emitModuleDecisionCallback(tx, {
        tenantId: p.tenantId, fileId: p.fileId, correlationId: msg.correlationId,
        decision: "rejected", decidedBy: p.rejectedBy,
      });
      await audit(tx, msg, "reject", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.notingSign, async (msg) => {
    const p = msg.payload as { fileId: string; notingId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const noting = await repo.findNotingById(p.notingId, p.tenantId);
      if (!noting || noting.fileId !== p.fileId) return;
      // Already-signed notes are immutable (DB trigger also enforces this).
      if (noting.noteStatus === "approved" || noting.eSigned) return;
      await signNotingChain(tx, {
        tenantId: p.tenantId, fileId: p.fileId, notingId: noting.id,
        body: noting.body, officerId: msg.actorId,
      });
      await audit(tx, msg, "sign_noting", "noting", p.notingId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  // G2 unification — workflow emits estab.file.level_approved on each APPROVE at
  // a file_noting level; auto-sign (green) that level's latest unsigned note so
  // the file accrues the SO→US→DS hash chain without a separate manual step.
  queue.subscribe(WORKFLOW_TASK_COMPLETED, async (msg) => {
    const p = msg.payload as { fileId?: string };
    if (!p.fileId) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const noting = await repo.findLatestUnsignedNoting(tx, p.fileId!, msg.tenantId);
      if (!noting) return;
      await signNotingChain(tx, {
        tenantId: msg.tenantId, fileId: p.fileId!, notingId: noting.id,
        body: noting.body, officerId: msg.actorId,
      });
      await audit(tx, msg, "level_sign_noting", "noting", noting.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.fileMove, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; toOfficer: string; remarks?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findFileById(p.fileId, p.tenantId);
      if (existing?.status === "closed") {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "estab", action: "move_rejected_closed_file", resourceType: "file", resourceId: p.fileId, outcome: "rejected" },
        });
        return;
      }
      await repo.insertFileMovement(tx, {
        id: randomUUID(), tenantId: p.tenantId, fileId: p.fileId,
        fromOfficerId: existing?.currentWith ?? null,
        toOfficerId: p.toOfficer, action: "forward", remarks: p.remarks ?? null,
      });
      await repo.updateFile(tx, p.fileId, { currentWith: p.toOfficer, status: "active", updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.fileMoved, eventType: EVENTS.fileMoved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fileId: p.fileId, toOfficer: p.toOfficer, remarks: p.remarks ?? "" },
      });
      await audit(tx, msg, "move", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.fileClose, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; remarks?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // CSMOP/RRS: a file may be closed only after a record category has been
      // assigned (disposal classification). Without it, closure is rejected so
      // no file escapes the retention regime.
      if (!(await recordsRepo.hasRecordCategoryTx(tx, p.tenantId, p.fileId))) {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "estab", action: "close_rejected_no_record_category", resourceType: "file", resourceId: p.fileId, outcome: "rejected" },
        });
        return;
      }
      await repo.updateFile(tx, p.fileId, { status: "closed", updatedBy: msg.actorId });
      await audit(tx, msg, "close", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  // CSMOP movement verb — RECALL: the sender pulls a wrongly-marked file back.
  queue.subscribe(COMMANDS.fileRecall, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; remarks?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findFileById(p.fileId, p.tenantId);
      if (!existing || existing.status === "closed") return;
      await repo.insertFileMovement(tx, {
        id: randomUUID(), tenantId: p.tenantId, fileId: p.fileId,
        fromOfficerId: existing.currentWith, toOfficerId: msg.actorId,
        action: "recall", remarks: p.remarks ?? null,
      });
      await repo.updateFile(tx, p.fileId, { currentWith: msg.actorId, status: "active", updatedBy: msg.actorId });
      await audit(tx, msg, "recall", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  // CSMOP — REOPEN a closed file (with reason); restores it to active.
  queue.subscribe(COMMANDS.fileReopen, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findFileById(p.fileId, p.tenantId);
      if (!existing || existing.status !== "closed") return;
      await repo.updateFile(tx, p.fileId, { status: "active", updatedBy: msg.actorId });
      await repo.insertFileMovement(tx, {
        id: randomUUID(), tenantId: p.tenantId, fileId: p.fileId,
        fromOfficerId: existing.currentWith, toOfficerId: msg.actorId,
        action: "reopen", remarks: p.reason,
      });
      await audit(tx, msg, "reopen", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  // ── R2 file-type taxonomy: open the next VOLUME of a main file ─────────────
  queue.subscribe(COMMANDS.fileOpenVolume, async (msg) => {
    const p = msg.payload as { id: string; baseFileId: string; tenantId: string; currentWith: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const base = await repo.findFileById(p.baseFileId, p.tenantId);
      if (!base) return;
      // The "root" of a volume set is the main file (or the parent of a volume).
      const rootId = base.parentFileId ?? base.id;
      const maxRows = await tx.execute(sql`
        SELECT MAX(volume_no) AS max_vol FROM files.estab_files
        WHERE tenant_id = ${p.tenantId} AND (id = ${rootId} OR parent_file_id = ${rootId})
      `);
      const maxVol = Number((maxRows as unknown as Array<{ max_vol: number | null }>)[0]?.max_vol ?? 1);
      const nextVol = maxVol + 1;
      const root = rootId === base.id ? base : await repo.findFileById(rootId, p.tenantId);
      const baseNo = root?.fileNo ?? base.fileNo;
      await repo.insertFile(tx, {
        id: p.id, tenantId: p.tenantId,
        fileNo: deriveChildFileNo(baseNo, "volume", nextVol),
        subject: base.subject, dept: base.dept, priority: base.priority,
        classification: base.classification,
        currentWith: p.currentWith ?? base.currentWith, status: "active",
        dueBy: computeFileDueBy(), parentFileId: rootId,
        fileType: "volume", volumeNo: nextVol,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "open_volume", "file", p.id, { rootId, volumeNo: nextVol });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.id));
  });

  // ── R2 file-type taxonomy: open a PART file of a main file ─────────────────
  queue.subscribe(COMMANDS.fileOpenPart, async (msg) => {
    const p = msg.payload as { id: string; baseFileId: string; tenantId: string; subject: string | null; currentWith: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const base = await repo.findFileById(p.baseFileId, p.tenantId);
      if (!base) return;
      const rootId = base.parentFileId ?? base.id;
      const maxRows = await tx.execute(sql`
        SELECT MAX(part_no) AS max_part FROM files.estab_files
        WHERE tenant_id = ${p.tenantId} AND parent_file_id = ${rootId} AND file_type = 'part'
      `);
      const nextPart = Number((maxRows as unknown as Array<{ max_part: number | null }>)[0]?.max_part ?? 0) + 1;
      const root = rootId === base.id ? base : await repo.findFileById(rootId, p.tenantId);
      const baseNo = root?.fileNo ?? base.fileNo;
      await repo.insertFile(tx, {
        id: p.id, tenantId: p.tenantId,
        fileNo: deriveChildFileNo(baseNo, "part", nextPart),
        subject: p.subject ?? base.subject, dept: base.dept, priority: base.priority,
        classification: base.classification,
        currentWith: p.currentWith ?? base.currentWith, status: "active",
        dueBy: computeFileDueBy(), parentFileId: rootId,
        fileType: "part", partNo: nextPart,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "open_part", "file", p.id, { rootId, partNo: nextPart });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.id));
  });

  // ── R2 file-type taxonomy: symmetrically LINK two files ────────────────────
  queue.subscribe(COMMANDS.fileLink, async (msg) => {
    const p = msg.payload as { fileId: string; targetFileId: string; tenantId: string };
    if (p.fileId === p.targetFileId) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const a = await repo.findFileById(p.fileId, p.tenantId);
      const b = await repo.findFileById(p.targetFileId, p.tenantId);
      if (!a || !b) return;
      const aLinks = Array.from(new Set([...(a.linkedFileIds ?? []), b.id]));
      const bLinks = Array.from(new Set([...(b.linkedFileIds ?? []), a.id]));
      await repo.updateFile(tx, a.id, { linkedFileIds: aLinks, updatedBy: msg.actorId });
      await repo.updateFile(tx, b.id, { linkedFileIds: bLinks, updatedBy: msg.actorId });
      await audit(tx, msg, "link", "file", a.id, { targetFileId: b.id });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.targetFileId));
  });

  // ── R2 file-type taxonomy: reclassify a file's type ────────────────────────
  queue.subscribe(COMMANDS.fileSetType, async (msg) => {
    const p = msg.payload as { fileId: string; fileType: string; tenantId: string };
    assertValidFileType(p.fileType);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const f = await repo.findFileById(p.fileId, p.tenantId);
      if (!f) return;
      await repo.updateFile(tx, p.fileId, { fileType: p.fileType, updatedBy: msg.actorId });
      await audit(tx, msg, "set_type", "file", p.fileId, { fileType: p.fileType });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.dispatchCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; dispatchNo?: string; fileId?: string; toAddress: string; mode: string; subject: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // CSMOP gapless dispatch number when the caller did not supply one.
      const dispatchNo = p.dispatchNo ?? await repo.allocateDispatchNo(tx, p.tenantId, new Date().getFullYear());
      await repo.insertDispatch(tx, {
        id: p.id, tenantId: p.tenantId, dispatchNo,
        fileId: p.fileId ?? null, toAddress: p.toAddress, mode: p.mode, subject: p.subject,
        dispatchedAt: new Date(), status: "sent", deliveryStatus: "sent",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "dispatch", p.id);
    });
  });

  queue.subscribe(COMMANDS.inwardRegister, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; dakNo: string; fromAddress: string; subject: string;
      assignedTo?: string; sourceSection?: string;
      mode?: string; language?: string; urgency?: string; category?: string;
      receivedDate?: string; dueDate?: string;
    };
    const barcode = `DAK-${p.dakNo.replace(/\//g, "-")}`;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertInward(tx, {
        id: p.id, tenantId: p.tenantId, dakNo: p.dakNo,
        fromAddress: p.fromAddress, subject: p.subject,
        assignedTo: p.assignedTo ?? null, fileRef: null, fileId: null,
        barcode, sourceSection: p.sourceSection ?? null,
        mode: p.mode ?? null, language: p.language ?? null,
        urgency: p.urgency ?? null, category: p.category ?? null,
        receivedDate: p.receivedDate ?? new Date().toISOString().slice(0, 10),
        dueDate: p.dueDate ?? null,
        status: "received",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertInwardMovement(tx, {
        tenantId: p.tenantId, inwardId: p.id, fromOfficer: null,
        toOfficer: p.assignedTo ?? null, action: "received", remarks: null,
      });
      await audit(tx, msg, "register", "inward", p.id);
    });
  });

  // CSMOP B2 — attach an already-diarised receipt to an EXISTING file.
  queue.subscribe(COMMANDS.inwardAttach, async (msg) => {
    const p = msg.payload as { tenantId: string; inwardId: string; fileId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inward = await repo.findInwardById(p.inwardId, p.tenantId);
      const file = await repo.findFileById(p.fileId, p.tenantId);
      if (!inward || !file) return;
      await repo.updateInward(tx, p.inwardId, { fileId: p.fileId, fileRef: file.fileNo, status: "attached", updatedBy: msg.actorId });
      await repo.insertInwardMovement(tx, {
        tenantId: p.tenantId, inwardId: p.inwardId, fromOfficer: inward.assignedTo ?? null,
        toOfficer: file.currentWith, action: "attached_to_file", remarks: file.fileNo,
      });
      await audit(tx, msg, "attach_to_file", "inward", p.inwardId);
    });
  });

  // CSMOP B3 — detach a wrongly-attached receipt; reason is mandatory + audited.
  queue.subscribe(COMMANDS.inwardDetach, async (msg) => {
    const p = msg.payload as { tenantId: string; inwardId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inward = await repo.findInwardById(p.inwardId, p.tenantId);
      if (!inward) return;
      await repo.updateInward(tx, p.inwardId, {
        fileId: null, fileRef: null, status: "detached",
        detachedReason: p.reason, detachedAt: new Date(), updatedBy: msg.actorId,
      });
      await repo.insertInwardMovement(tx, {
        tenantId: p.tenantId, inwardId: p.inwardId, fromOfficer: null,
        toOfficer: inward.assignedTo ?? null, action: "detached", remarks: p.reason,
      });
      await audit(tx, msg, "detach_from_file", "inward", p.inwardId);
    });
  });

  // Dispatch delivery proof/status update.
  queue.subscribe(COMMANDS.dispatchDelivery, async (msg) => {
    const p = msg.payload as { tenantId: string; dispatchId: string; deliveryStatus: string; deliveryProof?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateDispatch(tx, p.dispatchId, p.tenantId, {
        deliveryStatus: p.deliveryStatus,
        deliveredAt: p.deliveryStatus === "delivered" ? new Date() : null,
        deliveryProof: p.deliveryProof ?? null,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "delivery_update", "dispatch", p.dispatchId);
    });
  });

  queue.subscribe(COMMANDS.fileAttachmentAdd, async (msg) => {
    const p = msg.payload as {
      id: string; fileId: string; tenantId: string; fileName: string;
      fileType: string; sizeBytes: number; storageRef?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAttachment(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId,
        fileName: p.fileName, fileType: p.fileType, sizeBytes: p.sizeBytes,
        storageRef: p.storageRef ?? null,
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "add_attachment", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success", metadata },
  });
}
