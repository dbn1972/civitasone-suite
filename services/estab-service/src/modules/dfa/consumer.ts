import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { canTransition, isEditable, type DfaStatus } from "./domain.js";
import { insertDispatch } from "../files/repo.js";
import type { CreateDfaBody, UpdateDfaBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

type CreatePayload = CreateDfaBody & { id: string; tenantId: string; dfaNo: string };

function audit(msg: { tenantId: string; actorId: string; correlationId: string }, action: string, id: string, metadata: Record<string, unknown> = {}) {
  return {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType: "dfa", resourceId: id, outcome: "success" as const, metadata },
  };
}

export function registerDfaConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.dfaCreate, async (msg) => {
    const p = msg.payload as CreatePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDfa(tx, {
        id: p.id, tenantId: p.tenantId, dfaNo: p.dfaNo,
        fileId: p.fileId ?? null, communicationType: p.communicationType,
        templateCode: p.templateCode ?? null,
        subject: p.subject, body: p.body,
        recipientEmployeeId: p.recipientEmployeeId ?? null,
        recipientName: p.recipientName ?? null, recipientAddress: p.recipientAddress ?? null,
        status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, audit(msg, "dfa.create", p.id, { dfaNo: p.dfaNo, type: p.communicationType }));
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "dfa", p.id));
  });

  queue.subscribe(COMMANDS.dfaUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; patch: UpdateDfaBody };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findDfaById(p.id, p.tenantId);
      if (!cur || !isEditable(cur.status)) return;
      const patch: Parameters<typeof repo.updateDfa>[2] = { updatedBy: msg.actorId, version: cur.version + 1 };
      if (p.patch.communicationType !== undefined) patch.communicationType = p.patch.communicationType;
      if (p.patch.templateCode !== undefined) patch.templateCode = p.patch.templateCode;
      if (p.patch.subject !== undefined) patch.subject = p.patch.subject;
      if (p.patch.body !== undefined) patch.body = p.patch.body;
      if (p.patch.recipientEmployeeId !== undefined) patch.recipientEmployeeId = p.patch.recipientEmployeeId;
      if (p.patch.recipientName !== undefined) patch.recipientName = p.patch.recipientName;
      if (p.patch.recipientAddress !== undefined) patch.recipientAddress = p.patch.recipientAddress;
      await repo.updateDfa(tx, p.id, patch);
      await enqueue(tx, audit(msg, "dfa.update", p.id));
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "dfa", p.id));
  });

  // Status transitions share a helper.
  const transition = (
    topic: string,
    to: DfaStatus,
    apply?: (p: { id: string; tenantId: string } & Record<string, unknown>, cur: NonNullable<Awaited<ReturnType<typeof repo.findDfaById>>>) => Partial<Parameters<typeof repo.updateDfa>[2]>,
  ) => {
    queue.subscribe(topic, async (msg) => {
      const p = msg.payload as { id: string; tenantId: string } & Record<string, unknown>;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const cur = await repo.findDfaById(p.id, p.tenantId);
        if (!cur || !canTransition(cur.status, to)) return;
        const patch: Parameters<typeof repo.updateDfa>[2] = {
          status: to, updatedBy: msg.actorId, version: cur.version + 1,
          ...(apply?.(p, cur) ?? {}),
        };
        await repo.updateDfa(tx, p.id, patch);
        await enqueue(tx, audit(msg, `dfa.${to}`, p.id));
      });
      await cache.invalidate(cache.makeKey(p.tenantId, "dfa", p.id));
    });
  };

  transition(COMMANDS.dfaSubmit, "pending_approval");
  transition(COMMANDS.dfaApprove, "approved", (p) => ({ approvedBy: String(p.approvedBy ?? ""), approvedAt: new Date() }));
  transition(COMMANDS.dfaReturn, "returned", (p) => ({ returnedReason: String(p.reason ?? "") }));
  transition(COMMANDS.dfaSign, "signed", (p) => ({ signedBy: String(p.signedBy ?? ""), signedAt: new Date() }));

  // Dispatch: move to dispatched AND create a dispatch record.
  queue.subscribe(COMMANDS.dfaDispatch, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; mode: string; toAddress: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findDfaById(p.id, p.tenantId);
      if (!cur || !canTransition(cur.status, "dispatched")) return;

      const dispatchId = randomUUID();
      await insertDispatch(tx, {
        id: dispatchId, tenantId: p.tenantId,
        dispatchNo: `DSP/${new Date().getFullYear()}/${cur.dfaNo.split("/").pop() ?? "0001"}`,
        fileId: cur.fileId ?? null,
        toAddress: p.toAddress ?? cur.recipientAddress ?? cur.recipientName ?? "—",
        mode: p.mode, subject: cur.subject,
        dispatchedAt: new Date(), status: "dispatched",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateDfa(tx, p.id, {
        status: "dispatched", dispatchId, updatedBy: msg.actorId, version: cur.version + 1,
      });
      await enqueue(tx, audit(msg, "dfa.dispatched", p.id, { dispatchId, mode: p.mode }));
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "dfa", p.id));
  });
}
