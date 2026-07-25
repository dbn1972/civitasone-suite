import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as invoiceRepo from "../invoices/repo.js";
import { generateIrn, cancelIrn, type EInvoicePayload } from "./nic-client.js";
import { sql } from "drizzle-orm";
import { einvoiceRequests } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function registerEInvoiceConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  // ── Generate IRN ────────────────────────────────────────────────
  queue.subscribe<{ id: string; invoiceId: string; tenantId: string }>(
    COMMANDS.einvoiceGenerate,
    async (msg) => {
      const { id, invoiceId, tenantId } = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Insert a pending request record
        await repo.insertRequest(tx, {
          id,
          tenantId,
          invoiceId,
          status: "pending",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
      });

      // Fetch the invoice + items outside the initial tx for payload building
      const invoice = await invoiceRepo.findById(invoiceId);
      if (!invoice || invoice.tenantId !== tenantId) {
        await db.transaction(async (tx) => {
          await repo.updateRequest(tx, id, {
            status: "failed",
            errorMessage: `Invoice ${invoiceId} not found or tenant mismatch`,
            updatedBy: msg.actorId,
          });
        });
        return;
      }

      const items = await invoiceRepo.itemsByInvoice(invoiceId);

      // Build NIC payload — convert from paise (internal) to rupees (NIC API)
      const totalRupees = Number(invoice.totalMinor) / 100;
      const taxRupees = Number(invoice.taxMinor) / 100;

      const payload: EInvoicePayload = {
        version: "1.1",
        tranDtls: { taxSch: "GST", supTyp: "B2B", regRev: "N" },
        docDtls: {
          typ: "INV",
          no: invoiceId.slice(0, 16), // Use invoice ID prefix as doc number
          dt: formatDateDDMMYYYY(invoice.createdAt),
        },
        sellerDtls: {
          gstin: process.env.EINVOICE_GSTIN ?? "00AAAAA0000A1Z5",
          lglNm: process.env.EINVOICE_SELLER_NAME ?? "Seller",
          addr1: process.env.EINVOICE_SELLER_ADDR ?? "Address",
          loc: process.env.EINVOICE_SELLER_LOC ?? "City",
          pin: Number(process.env.EINVOICE_SELLER_PIN ?? "110001"),
          stcd: process.env.EINVOICE_SELLER_STCD ?? "07",
        },
        buyerDtls: {
          gstin: "00BBBBB0000B1Z5", // Will be populated from tenant/customer data
          lglNm: "Buyer",
          addr1: "Address",
          loc: "City",
          pin: 110001,
          stcd: "07",
          pos: "07",
        },
        itemList: items.map((item, idx) => {
          const amtRupees = Number(item.amountMinor) / 100;
          return {
            slNo: String(idx + 1),
            prdDesc: item.description,
            isServc: "Y" as const,
            hsnCd: "998311", // Default HSN for services
            qty: Number(item.quantity),
            unit: "NOS",
            unitPrice: amtRupees / Number(item.quantity),
            totAmt: amtRupees,
            gstRt: 18, // Default GST rate
            igstAmt: 0,
            cgstAmt: amtRupees * 0.09,
            sgstAmt: amtRupees * 0.09,
            totItemVal: amtRupees + amtRupees * 0.18,
          };
        }),
        valDtls: {
          assVal: totalRupees - taxRupees,
          cgstVal: taxRupees / 2,
          sgstVal: taxRupees / 2,
          igstVal: 0,
          totInvVal: totalRupees,
        },
      };

      try {
        const result = await generateIrn(payload);

        await db.transaction(async (tx) => {
          await repo.updateRequest(tx, id, {
            status: "generated",
            irn: result.irn,
            ackNo: result.ackNo,
            ackDate: new Date(result.ackDate),
            signedInvoice: result.signedInvoice,
            signedQrCode: result.signedQrCode,
            updatedBy: msg.actorId,
          });
          await audit(tx, msg, "einvoice_generate", id);
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error generating IRN";
        await db.transaction(async (tx) => {
          await repo.updateRequest(tx, id, {
            status: "failed",
            errorMessage,
            updatedBy: msg.actorId,
          });
          await enqueue(tx, {
            topic: AUDIT_TOPIC,
            eventType: AUDIT_TOPIC,
            tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              service: "billing",
              action: "einvoice_generate_failed",
              resourceType: "einvoice",
              resourceId: id,
              outcome: "failed",
              error: errorMessage,
            },
          });
        });
      }

      await cache.invalidate(cache.makeKey(tenantId, "einvoice", invoiceId));
    },
  );

  // ── Cancel IRN ──────────────────────────────────────────────────
  queue.subscribe<{ id: string; invoiceId: string; tenantId: string; reason: string }>(
    COMMANDS.einvoiceCancel,
    async (msg) => {
      const { id, invoiceId, tenantId, reason } = msg.payload;

      // Find the existing e-invoice request for this invoice
      const existing = await repo.findByInvoiceId(invoiceId, tenantId);

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        if (!existing || existing.status !== "generated" || !existing.irn) {
          // Nothing to cancel or already cancelled/failed
          await enqueue(tx, {
            topic: AUDIT_TOPIC,
            eventType: AUDIT_TOPIC,
            tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              service: "billing",
              action: "einvoice_cancel_skipped",
              resourceType: "einvoice",
              resourceId: id,
              outcome: "skipped",
              reason: "No active IRN found",
            },
          });
          return;
        }

        // NIC rule: cancellation only within 24 hours of generation
        const ackDate = existing.ackDate ?? existing.createdAt;
        const hoursSinceGeneration = (Date.now() - ackDate.getTime()) / (1000 * 60 * 60);
        if (hoursSinceGeneration > 24) {
          await repo.updateRequest(tx, existing.id, {
            status: "failed",
            errorMessage: "Cannot cancel IRN: 24-hour cancellation window exceeded",
            updatedBy: msg.actorId,
          });
          await enqueue(tx, {
            topic: AUDIT_TOPIC,
            eventType: AUDIT_TOPIC,
            tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              service: "billing",
              action: "einvoice_cancel_failed",
              resourceType: "einvoice",
              resourceId: existing.id,
              outcome: "failed",
              reason: "24h window exceeded",
            },
          });
          return;
        }
      });

      if (!existing || existing.status !== "generated" || !existing.irn) return;

      // Check time window again (race condition guard)
      const ackDate = existing.ackDate ?? existing.createdAt;
      const hoursSinceGeneration = (Date.now() - ackDate.getTime()) / (1000 * 60 * 60);
      if (hoursSinceGeneration > 24) return;

      try {
        await cancelIrn(existing.irn, reason);

        await db.transaction(async (tx) => {
          await tx
            .update(einvoiceRequests)
            .set({
              status: "cancelled",
              cancelledAt: new Date(),
              cancelReason: reason,
              updatedAt: new Date(),
              updatedBy: msg.actorId,
              version: sql`${einvoiceRequests.version} + 1`,
            })
            .where(sql`${einvoiceRequests.id} = ${existing.id}`);
          await audit(tx, msg, "einvoice_cancel", existing.id);
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error cancelling IRN";
        await db.transaction(async (tx) => {
          await repo.updateRequest(tx, existing.id, {
            status: "failed",
            errorMessage,
            updatedBy: msg.actorId,
          });
          await enqueue(tx, {
            topic: AUDIT_TOPIC,
            eventType: AUDIT_TOPIC,
            tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              service: "billing",
              action: "einvoice_cancel_failed",
              resourceType: "einvoice",
              resourceId: existing.id,
              outcome: "failed",
              error: errorMessage,
            },
          });
        });
      }

      await cache.invalidate(cache.makeKey(tenantId, "einvoice", invoiceId));
    },
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function formatDateDDMMYYYY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function audit(tx: Tx, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "billing", action, resourceType: "einvoice", resourceId, outcome: "success" },
  });
}
