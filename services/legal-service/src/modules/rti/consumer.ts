import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  computeResponseDeadline, computeTransferDeadline, computeAppealDisposalDeadline,
  assertStatusTransition, assertAppealTierAllowed, assertDifferentActor,
  type RtiStatus, type AppealTier, type AppealOrder,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

class StaleWriteError extends Error {
  readonly status = 409;
  readonly code = "VERSION_CONFLICT";
  constructor(resource: string, id: string) {
    super(`[VERSION_CONFLICT] ${resource} ${id} was modified concurrently`);
  }
}

export function registerRtiConsumers(queue: Queue): void {
  // ── receipt ────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.rtiApplicationCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; applicationNo: string; applicantName: string;
      applicantAddr?: string; subject: string; requestText: string; pioRef?: string;
      lifeOrLiberty?: boolean; thirdParty?: boolean; feePaid?: number; receivedAt?: string;
    };
    const receivedAt = p.receivedAt ? new Date(p.receivedAt) : new Date();
    const deadlineAt = computeResponseDeadline(receivedAt, { lifeOrLiberty: !!p.lifeOrLiberty, thirdParty: !!p.thirdParty });
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id, tenantId: p.tenantId, applicationNo: p.applicationNo,
        applicantName: p.applicantName, applicantAddr: p.applicantAddr ?? null,
        subject: p.subject, requestText: p.requestText, pioRef: p.pioRef ?? null,
        lifeOrLiberty: p.lifeOrLiberty ?? false, thirdParty: p.thirdParty ?? false,
        feePaid: String(p.feePaid ?? 0), receivedAt, deadlineAt,
        status: "received", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "receive", "rti_application", p.id, { applicationNo: p.applicationNo });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", "list:50"));
  });

  // ── §6(3) transfer to another authority — clock restarts, cross-service event
  queue.subscribe(COMMANDS.rtiTransfer, async (msg) => {
    const p = msg.payload as { applicationId: string; tenantId: string; toAuthority: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findByIdTx(tx, p.applicationId, p.tenantId);
      if (!app) throw new Error(`rti application ${p.applicationId} not found`);
      assertStatusTransition(app.status as RtiStatus, "transferred");
      const transferredAt = new Date();
      await repo.insertTransfer(tx, {
        tenantId: p.tenantId, applicationId: p.applicationId,
        fromAuthority: app.pioRef ?? "PIO", toAuthority: p.toAuthority,
        reason: p.reason ?? null, transferredAt, createdBy: msg.actorId,
      });
      const n = await repo.updateApplicationVersioned(tx, p.applicationId, p.tenantId, app.version ?? 1, {
        status: "transferred", pioRef: p.toAuthority,
        deadlineAt: computeTransferDeadline(transferredAt),
        updatedBy: msg.actorId, version: (app.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("rti_application", p.applicationId);
      // Cross-service: the receiving authority is notified via the outbox.
      await enqueue(tx, {
        topic: EVENTS.rtiTransferred, eventType: EVENTS.rtiTransferred,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { applicationId: p.applicationId, applicationNo: app.applicationNo, toAuthority: p.toAuthority },
      });
      await audit(tx, msg, "transfer", "rti_application", p.applicationId, { toAuthority: p.toAuthority });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.applicationId));
  });

  // ── §11 third-party consultation ─────────────────────────────────────────
  queue.subscribe(COMMANDS.rtiThirdPartyConsult, async (msg) => {
    const p = msg.payload as { applicationId: string; tenantId: string; thirdParty: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findByIdTx(tx, p.applicationId, p.tenantId);
      if (!app) throw new Error(`rti application ${p.applicationId} not found`);
      assertStatusTransition(app.status as RtiStatus, "third_party_consult");
      await repo.insertConsult(tx, {
        tenantId: p.tenantId, applicationId: p.applicationId, thirdParty: p.thirdParty,
        noticeAt: new Date(), createdBy: msg.actorId,
      });
      // §11: consultation extends the disclosure window to 40 days from receipt.
      const n = await repo.updateApplicationVersioned(tx, p.applicationId, p.tenantId, app.version ?? 1, {
        status: "third_party_consult", thirdParty: true,
        deadlineAt: computeResponseDeadline(app.receivedAt, { thirdParty: true }),
        updatedBy: msg.actorId, version: (app.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("rti_application", p.applicationId);
      await audit(tx, msg, "third_party_consult", "rti_application", p.applicationId, { thirdParty: p.thirdParty });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.applicationId));
  });

  // ── §7(3) additional fee ─────────────────────────────────────────────────
  queue.subscribe(COMMANDS.rtiAdditionalFee, async (msg) => {
    const p = msg.payload as { applicationId: string; tenantId: string; additionalFee: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findByIdTx(tx, p.applicationId, p.tenantId);
      if (!app) throw new Error(`rti application ${p.applicationId} not found`);
      const n = await repo.updateApplicationVersioned(tx, p.applicationId, p.tenantId, app.version ?? 1, {
        additionalFee: String(p.additionalFee),
        updatedBy: msg.actorId, version: (app.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("rti_application", p.applicationId);
      await audit(tx, msg, "additional_fee", "rti_application", p.applicationId, { additionalFee: p.additionalFee });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.applicationId));
  });

  // ── §7 disposal / response (with §8/§9 exemptions) ───────────────────────
  queue.subscribe(COMMANDS.rtiRespond, async (msg) => {
    const p = msg.payload as {
      applicationId: string; tenantId: string; decision: "provided" | "partial" | "rejected";
      responseText: string; exemptions?: { section: string; justification: string }[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findByIdTx(tx, p.applicationId, p.tenantId);
      if (!app) throw new Error(`rti application ${p.applicationId} not found`);
      const target: RtiStatus = p.decision === "rejected" ? "rejected" : "responded";
      assertStatusTransition(app.status as RtiStatus, target);
      await repo.insertResponse(tx, {
        tenantId: p.tenantId, applicationId: p.applicationId, decision: p.decision,
        responseText: p.responseText, respondedAt: new Date(), respondedBy: msg.actorId,
      });
      for (const ex of p.exemptions ?? []) {
        await repo.insertExemption(tx, {
          tenantId: p.tenantId, applicationId: p.applicationId,
          section: ex.section, justification: ex.justification,
          appliedAt: new Date(), createdBy: msg.actorId,
        });
      }
      const n = await repo.updateApplicationVersioned(tx, p.applicationId, p.tenantId, app.version ?? 1, {
        status: target, updatedBy: msg.actorId, version: (app.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("rti_application", p.applicationId);
      // Cross-service notification of disposal.
      await enqueue(tx, {
        topic: EVENTS.rtiResponded, eventType: EVENTS.rtiResponded,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { applicationId: p.applicationId, applicationNo: app.applicationNo, decision: p.decision },
      });
      await audit(tx, msg, "respond", "rti_application", p.applicationId, { decision: p.decision });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.applicationId));
  });

  // ── §19(1)/(3) file an appeal (tier-ordering enforced) ───────────────────
  queue.subscribe(COMMANDS.rtiAppealFile, async (msg) => {
    const p = msg.payload as {
      appealId: string; applicationId: string; tenantId: string;
      tier: AppealTier; appellateAuthority: string; grounds: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findByIdTx(tx, p.applicationId, p.tenantId);
      if (!app) throw new Error(`rti application ${p.applicationId} not found`);
      const existing = await repo.listAppealsForApplicationTx(tx, p.applicationId, p.tenantId);
      assertAppealTierAllowed(p.tier, existing.map((a) => ({ tier: a.tier as AppealTier, order: a.orderStatus as AppealOrder })));
      const filedAt = new Date();
      await repo.insertAppeal(tx, {
        id: p.appealId, tenantId: p.tenantId, applicationId: p.applicationId, tier: p.tier,
        appellateAuthority: p.appellateAuthority, grounds: p.grounds, filedAt,
        deadlineAt: computeAppealDisposalDeadline(filedAt, p.tier),
        orderStatus: "pending", filedBy: msg.actorId,
      });
      await audit(tx, msg, "file_appeal", "rti_appeal", p.appealId, { tier: p.tier });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.applicationId));
  });

  // ── §19 appeal ORDER — maker-checker (decider != filer) ──────────────────
  queue.subscribe(COMMANDS.rtiAppealOrder, async (msg) => {
    const p = msg.payload as {
      appealId: string; tenantId: string;
      orderStatus: "allowed" | "rejected" | "partly_allowed"; orderText: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const appeal = await repo.findAppealByIdTx(tx, p.appealId, p.tenantId);
      if (!appeal) throw new Error(`rti appeal ${p.appealId} not found`);
      if (appeal.orderStatus !== "pending") throw new Error(`appeal ${p.appealId} already decided`);
      // Maker-checker: the deciding authority must differ from the filer.
      assertDifferentActor(appeal.filedBy, msg.actorId, "appeal order");
      const n = await repo.updateAppealVersioned(tx, p.appealId, p.tenantId, appeal.version ?? 1, {
        orderStatus: p.orderStatus, orderText: p.orderText,
        decidedBy: msg.actorId, decidedAt: new Date(), version: (appeal.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("rti_appeal", p.appealId);
      await audit(tx, msg, "appeal_order", "rti_appeal", p.appealId, { orderStatus: p.orderStatus });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", appealApp(p.appealId)));
  });

  // ── §4 disclosure log ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.rtiDisclosureLog, async (msg) => {
    const p = msg.payload as { id: string; applicationId: string | null; tenantId: string; category: string; description: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDisclosure(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId,
        category: p.category, description: p.description, disclosedAt: new Date(), disclosedBy: msg.actorId,
      });
      await audit(tx, msg, "disclosure_log", "rti_disclosure", p.id, { category: p.category });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", "disclosures"));
  });
}

// cache-key helper (appeal cache is keyed loosely; invalidating a stable key is fine)
function appealApp(appealId: string): string {
  return `appeal:${appealId}`;
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string, newValue?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success", ...(newValue ? { newValue } : {}) },
  });
}
