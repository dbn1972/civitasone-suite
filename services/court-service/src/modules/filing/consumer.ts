import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as configRepo from "../config-registry/repo.js";
import { assertNonNegativeFee, resolveFees } from "./domain.js";

type SubmitFilingPayload = {
  id: string;
  caseId: string;
  tenantId: string;
  filingType: string;
  filingFeeMinor: number;
  courtFeeMinor: number;
};

export function registerFilingConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Submit a filing (§12/§31) — money-conservation guarded.
  register<SubmitFilingPayload>(COMMANDS.submitFiling, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // §47 fee_schedule: the SERVER-configured fee for this filing type is
      // authoritative (client-supplied amounts cannot lower/tamper it); a
      // malformed schedule or a negative amount is a poison message.
      const feeCfg = await configRepo.getConfigValueOnTx(tx, p.tenantId, "fee_schedule", p.filingType);
      let fees: { filingFeeMinor: number; courtFeeMinor: number; source: "config" | "client" };
      try {
        fees = resolveFees(feeCfg, { filingFeeMinor: p.filingFeeMinor, courtFeeMinor: p.courtFeeMinor });
        assertNonNegativeFee(fees.filingFeeMinor);
        assertNonNegativeFee(fees.courtFeeMinor);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await repo.insertFiling(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        filingType: p.filingType,
        filingFeeMinor: fees.filingFeeMinor,
        courtFeeMinor: fees.courtFeeMinor,
        status: "submitted",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.filingSubmitted,
        eventType: EVENTS.filingSubmitted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          caseId: p.caseId,
          filingId: p.id,
          filingType: p.filingType,
          filingFeeMinor: fees.filingFeeMinor,
          courtFeeMinor: fees.courtFeeMinor,
          feeSource: fees.source,
        },
      });
      await audit(tx, msg, "submit", "court_filing", p.id);
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
