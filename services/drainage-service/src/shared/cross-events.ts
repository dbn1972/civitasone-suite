/**
 * Cross-service outbox helpers for this municipal Sec5 service — emits
 * finance.challan.create (fee assessed) and notification.send (citizen
 * status updates) via the shared @civitasone/events contract.
 *
 * Ported from sewerage-service's shared/cross-events.ts (Wave 3, PR #1029),
 * the closest analog: another public-works maintenance service (not a
 * licensing/permit one) whose citizen-facing entities carry only a `uuid`
 * actor reference, never a display name.
 *
 * Wave 3: wired into complaints/consumer.ts (complaint-received notification
 * at complaintCreate, dispatched notification at complaintAssign, resolved
 * notification at complaintResolve) and field_actions/consumer.ts
 * (action-taken notification at fieldActionCreate) — see those files for
 * call sites. Not wired into hotspots/consumer.ts: hotspots are an internal
 * ops/planning entity (risk scoring, maintenance-plan refs) with no citizen
 * actor anywhere in hotspots/schema.ts, so there is no one to notify.
 *
 * emitMunicipalFeeChallan is kept here for interface parity with every other
 * municipal service's shared/cross-events.ts (all 17 are meant to be a
 * near-drop-in of this same module), but it has ZERO call sites in this
 * service: I read complaints/schema.ts, field_actions/schema.ts and
 * hotspots/schema.ts directly and none of the three tables carries a money
 * field of any kind (no amount/fee/tariff column, nor anything resembling
 * one) — drainage complaints and field actions are pure public-works
 * maintenance work, never a citizen-facing charge. Per this service's own
 * "no fake success" standard, do not invent a fee path just to exercise this
 * function; if a genuinely chargeable drainage product is ever added (e.g. a
 * paid private-drain-connection permit), wire it then, against that real
 * schema column.
 */
import { randomUUID } from "node:crypto";
import {
  FINANCE_CHALLAN_CREATE,
  NOTIFICATION_SEND,
  MUNICIPAL_EVENT_TYPES,
  buildMunicipalFeeChallanPayload,
  buildMunicipalStatusNotification,
  municipalDecisionNotificationEventType,
} from "@civitasone/events";
import { enqueue } from "./outbox.js";
import type { ScopedTx } from "./db.js";
import { SERVICE } from "../topics.js";

export type CrossEventCtx = {
  tenantId: string;
  actorId: string;
  correlationId: string;
};

/** Enqueue finance.challan.create when a drainage fee is assessed (fee > 0). Unused today — see file header. */
export async function emitMunicipalFeeChallan(
  tx: ScopedTx,
  ctx: CrossEventCtx,
  opts: {
    sourceRef: string;
    depositor: string;
    amountMinor: bigint;
    currency?: string;
    receiptHeadCode?: string;
  },
): Promise<void> {
  if (opts.amountMinor <= 0n) return;
  const payloadInput: Parameters<typeof buildMunicipalFeeChallanPayload>[0] = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    depositor: opts.depositor,
    amountMinor: opts.amountMinor,
    sourceService: SERVICE,
    sourceRef: opts.sourceRef,
  };
  if (opts.currency) payloadInput.currency = opts.currency;
  if (opts.receiptHeadCode) payloadInput.receiptHeadCode = opts.receiptHeadCode;
  await enqueue(tx, {
    topic: FINANCE_CHALLAN_CREATE,
    eventType: FINANCE_CHALLAN_CREATE,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: buildMunicipalFeeChallanPayload(payloadInput),
  });
}

/** Enqueue notification.send for citizen-facing status changes. */
export async function emitMunicipalNotification(
  tx: ScopedTx,
  ctx: CrossEventCtx,
  opts: {
    eventType: string;
    recipient: string;
    recipientId?: string;
    variables?: Record<string, string>;
  },
): Promise<void> {
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: buildMunicipalStatusNotification(opts),
  });
}

export { municipalDecisionNotificationEventType, MUNICIPAL_EVENT_TYPES };
