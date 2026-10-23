import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { administrativeApprovals, technicalSanctions } from "./schema.js";
import { and, eq } from "drizzle-orm";
import { NonRetryableError } from "@civitasone/queue";
import { isSelfApproval } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerApprovalConsumers(q: Queue): void {
  q.subscribe(COMMANDS.aaCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      // The route validates both (shared/validators.ts); re-checked here so a directly published command cannot
      // reach the insert with an Invalid Date or a zero/negative approved amount.
      const aaDate = new Date(p.aaDate as string);
      if (Number.isNaN(aaDate.getTime())) throw new NonRetryableError("INVALID_AA_DATE: aaDate is not a valid date");
      const approvedAmountMinor = BigInt(p.approvedAmountMinor as string | number);
      if (approvedAmountMinor <= 0n) throw new NonRetryableError("INVALID_AMOUNT: approved amount must be greater than zero");
      await tx.insert(administrativeApprovals).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        aaNumber: p.aaNumber as string,
        aaDate,
        approvingAuthorityId: p.approvingAuthorityId as string,
        approvingOfficeId: (p.approvingOfficeId as string) ?? undefined,
        approvedAmountMinor,
        remarks: (p.remarks as string) ?? undefined,
        approvalType: p.approvalType as string,
        status: "draft",
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.aaCreated,
        eventType: EVENTS.aaCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "aa", resourceId: p.id, outcome: "success" } });
    });
  });

  q.subscribe(COMMANDS.aaFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id } = msg.payload as { id: string };

      // GAP2-WORKS-APPROVALS-01: maker-checker enforced HERE (the consumer),
      // inside the transaction, so a directly-published or racing command
      // cannot bypass the route-level pre-check.
      const rows = await tx.select().from(administrativeApprovals)
        .where(and(eq(administrativeApprovals.tenantId, msg.tenantId), eq(administrativeApprovals.id, id)))
        .limit(1);
      const existing = rows[0];
      if (!existing) throw new NonRetryableError("AA_NOT_FOUND: AA not found for finalize");
      if (isSelfApproval(msg.actorId, { createdBy: existing.createdBy })) {
        throw new NonRetryableError("SELF_APPROVAL_FORBIDDEN: the creator of a AA cannot finalize it (maker-checker rule)");
      }

      await tx.update(administrativeApprovals)
        .set({ status: "finalized", finalizedBy: msg.actorId, finalizedAt: new Date() })
        .where(and(eq(administrativeApprovals.tenantId, msg.tenantId), eq(administrativeApprovals.id, id)));

      await enqueue(tx, {
        topic: EVENTS.aaFinalized,
        eventType: EVENTS.aaFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "finalize", resourceType: "aa", resourceId: id, outcome: "success" } });
    });
  });

  q.subscribe(COMMANDS.tsCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      // Same defence-in-depth as aaCreate: never insert an Invalid Date or a zero/negative sanctioned amount.
      const tsDate = new Date(p.tsDate as string);
      if (Number.isNaN(tsDate.getTime())) throw new NonRetryableError("INVALID_TS_DATE: tsDate is not a valid date");
      const tsAmountMinor = BigInt(p.tsAmountMinor as string | number);
      if (tsAmountMinor <= 0n) throw new NonRetryableError("INVALID_AMOUNT: sanctioned amount must be greater than zero");
      await tx.insert(technicalSanctions).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        tsNumber: p.tsNumber as string,
        tsDate,
        tsAuthorityId: p.tsAuthorityId as string,
        tsOfficeId: (p.tsOfficeId as string) ?? undefined,
        srYear: (p.srYear as string) ?? undefined,
        zone: (p.zone as string) ?? undefined,
        tsAmountMinor,
        remarks: (p.remarks as string) ?? undefined,
        sanctionType: p.sanctionType as string,
        status: "draft",
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.tsCreated,
        eventType: EVENTS.tsCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "ts", resourceId: p.id, outcome: "success" } });
    });
  });

  q.subscribe(COMMANDS.tsFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id } = msg.payload as { id: string };

      // GAP2-WORKS-APPROVALS-01: maker-checker enforced HERE (the consumer),
      // inside the transaction, so a directly-published or racing command
      // cannot bypass the route-level pre-check.
      const rows = await tx.select().from(technicalSanctions)
        .where(and(eq(technicalSanctions.tenantId, msg.tenantId), eq(technicalSanctions.id, id)))
        .limit(1);
      const existing = rows[0];
      if (!existing) throw new NonRetryableError("TS_NOT_FOUND: TS not found for finalize");
      if (isSelfApproval(msg.actorId, { createdBy: existing.createdBy })) {
        throw new NonRetryableError("SELF_APPROVAL_FORBIDDEN: the creator of a TS cannot finalize it (maker-checker rule)");
      }

      await tx.update(technicalSanctions)
        .set({ status: "finalized", finalizedBy: msg.actorId, finalizedAt: new Date() })
        .where(and(eq(technicalSanctions.tenantId, msg.tenantId), eq(technicalSanctions.id, id)));

      await enqueue(tx, {
        topic: EVENTS.tsFinalized,
        eventType: EVENTS.tsFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "finalize", resourceType: "ts", resourceId: id, outcome: "success" } });
    });
  });
}
