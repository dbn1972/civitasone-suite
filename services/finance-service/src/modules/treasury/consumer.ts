import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as budgetRepo from "../budget/repo.js";
import { enqueueSpineJournal } from "../gl/spine.js";
import type { JournalLine } from "../gl/schema.js";

const BANK_CODE = process.env.FINANCE_BANK_CODE ?? "1100";

const AUDIT_TOPIC = "audit.event.record";

export function registerTreasuryConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.challanCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; challanNo: string; receiptHeadId: string;
      depositor: string; amountMinor: number; currency?: string; grnNo?: string;
      bankAccountId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertChallan(tx, {
        id: p.id, tenantId: p.tenantId, challanNo: p.challanNo,
        receiptHeadId: p.receiptHeadId, depositor: p.depositor,
        amountMinor: BigInt(p.amountMinor), currency: p.currency ?? "INR",
        ...(p.bankAccountId ? { bankAccountId: p.bankAccountId } : {}),
        grnNo: p.grnNo ?? null, status: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // GL spine: challan/receipt deposited -> Dr Bank / Cr receipt head.
      const bankHead = await budgetRepo.findHeadByCodeTx(tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], p.tenantId, BANK_CODE);
      if (!bankHead) throw new Error(`MISSING_CONTROL_HEAD: bank head code ${BANK_CODE} not found for tenant`);
      const amount = BigInt(p.amountMinor);
      const lines: JournalLine[] = [
        { accountCode: bankHead.id,      debitMinor: amount, creditMinor: 0n },
        { accountCode: p.receiptHeadId,  debitMinor: 0n,     creditMinor: amount },
      ];
      await enqueueSpineJournal(tx, {
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        sourceKey: `challan:${p.id}`, type: "receipt",
        postingDate: new Date().toISOString().slice(0, 10), lines,
      });
      await audit(tx, msg, "create", "challan", p.id);
    });
  });

  queue.subscribe(COMMANDS.depositCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; pdNo: string; type: string;
      administrator: string; balanceMinor: number; currency?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDeposit(tx, {
        id: p.id, tenantId: p.tenantId, pdNo: p.pdNo, type: p.type,
        administrator: p.administrator, balanceMinor: BigInt(p.balanceMinor),
        currency: p.currency ?? "INR", status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "deposit", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
