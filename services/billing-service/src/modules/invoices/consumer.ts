import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  shouldSkipInvoiceGeneration,
  assertIssuable,
  assertCancellable,
  type LineItemInput,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const NOTIFICATION_TOPIC = "notification.alert.send";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function registerInvoicesConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  // ── legacy usage-based generation (govt-exempt skip) ────────────
  queue.subscribe<{ id: string; tenantId: string; periodMonth: string; govtExempt: boolean; totalMinor: number }>(
    COMMANDS.invoiceGenerate,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        if (shouldSkipInvoiceGeneration(msg.payload.govtExempt)) {
          await enqueue(tx, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.payload.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { service: "billing", action: "invoice_skipped_govt_exempt", resourceType: "invoice", resourceId: msg.payload.id, outcome: "skipped" },
          });
          return;
        }
        const total = BigInt(msg.payload.totalMinor);
        await repo.insertInvoice(tx, {
          id: msg.payload.id, tenantId: msg.payload.tenantId, periodMonth: msg.payload.periodMonth,
          status: "draft", totalMinor: total, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await repo.insertItem(tx, {
          tenantId: msg.payload.tenantId, invoiceId: msg.payload.id,
          description: `Usage for ${msg.payload.periodMonth}`, amountMinor: total,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "invoice_generate", msg.payload.id);
      });
      await cache.invalidateResource(msg.payload.tenantId, "invoices");
    },
  );

  // ── create a draft bill from explicit line items ────────────────
  queue.subscribe<{
    id: string; tenantId: string; periodMonth: string; items: LineItemInput[];
    taxMinor: string; chargesMinor: string; totalMinor: string;
  }>(COMMANDS.invoiceCreate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertInvoice(tx, {
        id: p.id, tenantId: p.tenantId, periodMonth: p.periodMonth, status: "draft",
        totalMinor: BigInt(p.totalMinor), taxMinor: BigInt(p.taxMinor), chargesMinor: BigInt(p.chargesMinor),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      for (const it of p.items) {
        await repo.insertItem(tx, {
          tenantId: p.tenantId, invoiceId: p.id, description: it.description,
          kind: it.kind ?? "line", quantity: BigInt(it.quantity ?? 1),
          amountMinor: BigInt(it.amountMinor), createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await audit(tx, msg, "invoice_create", p.id);
    });
    await cache.invalidateResource(p.tenantId, "invoices");
  });

  // ── direct issue (below maker-checker threshold) ────────────────
  queue.subscribe<{ id: string }>(COMMANDS.invoiceIssue, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await executeIssue(tx, msg.payload.id, msg.tenantId, msg.actorId, msg.correlationId);
    });
    await cache.invalidateResource(msg.tenantId, "invoices");
    await cache.invalidate(cache.makeKey(msg.tenantId, "invoice", msg.payload.id));
  });

  // ── direct cancel (below maker-checker threshold) ───────────────
  queue.subscribe<{ id: string; reason: string }>(COMMANDS.invoiceCancel, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await executeCancel(tx, msg.payload.id, msg.payload.reason, msg.tenantId, msg.actorId, msg.correlationId);
    });
    await cache.invalidateResource(msg.tenantId, "invoices");
    await cache.invalidate(cache.makeKey(msg.tenantId, "invoice", msg.payload.id));
  });

  // ── request issue (maker step) → pending approval ───────────────
  queue.subscribe<{ approvalId: string; invoiceId: string; action: "issue"; amountMinor: string }>(
    COMMANDS.invoiceRequestIssue, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const inv = await repo.findByIdTx(tx, msg.payload.invoiceId);
        if (!inv || inv.tenantId !== msg.tenantId) throw new Error(`invoice ${msg.payload.invoiceId} not found`);
        assertIssuable(inv.status);
        await repo.insertApproval(tx, {
          id: msg.payload.approvalId, tenantId: msg.tenantId, invoiceId: msg.payload.invoiceId,
          action: "issue", status: "pending", amountMinor: BigInt(msg.payload.amountMinor),
          requestedBy: msg.actorId, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "issue_requested", msg.payload.invoiceId);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "invoice", msg.payload.invoiceId));
    },
  );

  // ── request cancel (maker step) → pending approval ──────────────
  queue.subscribe<{ approvalId: string; invoiceId: string; action: "cancel"; amountMinor: string; reason: string }>(
    COMMANDS.invoiceRequestCancel, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const inv = await repo.findByIdTx(tx, msg.payload.invoiceId);
        if (!inv || inv.tenantId !== msg.tenantId) throw new Error(`invoice ${msg.payload.invoiceId} not found`);
        assertCancellable(inv.status);
        await repo.insertApproval(tx, {
          id: msg.payload.approvalId, tenantId: msg.tenantId, invoiceId: msg.payload.invoiceId,
          action: "cancel", status: "pending", amountMinor: BigInt(msg.payload.amountMinor),
          requestedBy: msg.actorId, reason: msg.payload.reason, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "cancel_requested", msg.payload.invoiceId);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "invoice", msg.payload.invoiceId));
    },
  );

  // ── checker decision: approve/reject; on approve, execute action ─
  queue.subscribe<{ approvalId: string; approve: boolean; reason?: string }>(
    COMMANDS.invoiceApprovalDecide, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const ap = await repo.findApprovalByIdTx(tx, msg.payload.approvalId);
        if (!ap || ap.tenantId !== msg.tenantId) throw new Error(`approval ${msg.payload.approvalId} not found`);
        if (ap.status !== "pending") return; // already decided — idempotent no-op
        // Maker-checker separation of duties: the approver must differ from the requester.
        if (ap.requestedBy === msg.actorId) {
          throw new Error("MAKER_CHECKER_VIOLATION: approver must differ from requester");
        }
        const decided = msg.payload.approve ? "approved" : "rejected";
        await repo.decideApproval(tx, ap.id, {
          status: decided, decidedBy: msg.actorId, decidedAt: new Date(), updatedBy: msg.actorId,
        });
        if (msg.payload.approve) {
          if (ap.action === "issue") {
            await executeIssue(tx, ap.invoiceId, msg.tenantId, msg.actorId, msg.correlationId);
          } else {
            await executeCancel(tx, ap.invoiceId, ap.reason ?? "approved cancellation", msg.tenantId, msg.actorId, msg.correlationId);
          }
        }
        await audit(tx, msg, `approval_${decided}`, ap.invoiceId);
      });
      await cache.invalidateResource(msg.tenantId, "invoices");
    },
  );

  // ── direct pay (legacy, full settlement) ────────────────────────
  queue.subscribe<{ id: string }>(COMMANDS.invoicePay, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inv = await repo.findByIdTx(tx, msg.payload.id);
      if (!inv || inv.tenantId !== msg.tenantId) throw new Error(`invoice ${msg.payload.id} not found`);
      await repo.updateInvoice(tx, msg.payload.id, {
        status: "paid", paidMinor: inv.totalMinor, paidAt: new Date(), updatedBy: msg.actorId,
      });
      await audit(tx, msg, "invoice_pay", msg.payload.id);
    });
    await cache.invalidateResource(msg.tenantId, "invoices");
  });
}

// ── shared execution helpers ──────────────────────────────────────

async function executeIssue(tx: Tx, invoiceId: string, tenantId: string, actorId: string, correlationId: string): Promise<void> {
  const inv = await repo.findByIdTx(tx, invoiceId);
  if (!inv || inv.tenantId !== tenantId) throw new Error(`invoice ${invoiceId} not found`);
  assertIssuable(inv.status);
  await repo.updateInvoice(tx, invoiceId, { status: "issued", issuedAt: new Date(), issuedBy: actorId, updatedBy: actorId });
  await enqueue(tx, {
    topic: EVENTS.invoiceIssued, eventType: EVENTS.invoiceIssued,
    tenantId, actorId, correlationId, payload: { invoiceId, totalMinor: inv.totalMinor.toString() },
  });
  await enqueue(tx, {
    topic: NOTIFICATION_TOPIC, eventType: NOTIFICATION_TOPIC,
    tenantId, actorId, correlationId, payload: { alert: "invoice_issued", invoiceId },
  });
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId, actorId, correlationId,
    payload: { service: "billing", action: "invoice_issue", resourceType: "invoice", resourceId: invoiceId, outcome: "success" },
  });
}

async function executeCancel(tx: Tx, invoiceId: string, reason: string, tenantId: string, actorId: string, correlationId: string): Promise<void> {
  const inv = await repo.findByIdTx(tx, invoiceId);
  if (!inv || inv.tenantId !== tenantId) throw new Error(`invoice ${invoiceId} not found`);
  assertCancellable(inv.status);
  await repo.updateInvoice(tx, invoiceId, {
    status: "cancelled", cancelledAt: new Date(), cancelledBy: actorId, cancelReason: reason, updatedBy: actorId,
  });
  await enqueue(tx, {
    topic: EVENTS.invoiceCancelled, eventType: EVENTS.invoiceCancelled,
    tenantId, actorId, correlationId, payload: { invoiceId, reason },
  });
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId, actorId, correlationId,
    payload: { service: "billing", action: "invoice_cancel", resourceType: "invoice", resourceId: invoiceId, outcome: "success" },
  });
}

async function audit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  await enqueue(tx as Tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "billing", action, resourceType: "invoice", resourceId, outcome: "success" },
  });
}
