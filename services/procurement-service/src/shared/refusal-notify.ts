/**
 * UAT T-EDGE bundle 21 (TE-04): a create that the worker refuses AFTER the route said 202
 * (a race the synchronous checks cannot see: the indent was committed by another PO in the
 * meantime, the vendor was blacklisted, the sanction ran out ...) used to be dropped with
 * only an audit row. The maker now gets an in-app notification saying it was NOT saved and
 * why, written in the same transaction as the refusal audit. It appears in the in-app
 * notification inbox (bell) of the maker in the web app (notification-service in_app channel).
 */
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { enqueue } from "./outbox.js";

type Msg = { tenantId: string; actorId: string; correlationId: string };

/** Plain-language reason per refusal audit action (developer codes are never shown). */
const REFUSAL_TEXT: Record<string, string> = {
  rejected_no_sanction: "a purchase order above Rs 1,000 must cite an approved budget sanction",
  rejected_budget_exceeded: "the cited budget sanction does not have enough balance left",
  rejected_blacklisted: "the vendor is blacklisted",
  rejected_empanelment_expired: "the vendor empanelment has lapsed",
  rejected_vendor_not_empanelled: "the vendor has no empanelment, awarded tender or GeM order basis",
  rejected_indent_budget_exceeded: "the indent was not found, is not approved, or has no uncommitted amount left",
};

export function refusalText(action: string): string | null {
  return Object.prototype.hasOwnProperty.call(REFUSAL_TEXT, action) ? (REFUSAL_TEXT[action] as string) : null;
}

/** Tell the maker that their request was refused after it was accepted (in-app, same transaction). */
export async function notifyMakerOfRefusal(
  tx: unknown,
  msg: Msg,
  opts: { resourceType: string; resourceId: string; action: string; reason?: string; link?: string },
): Promise<void> {
  const reason = opts.reason ?? refusalText(opts.action) ?? "it did not pass a check when it was processed";
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: buildNotificationPayload({
      eventType: `procurement.${opts.resourceType}.refused`,
      recipient: msg.actorId,
      recipientId: msg.actorId,
      channel: "in_app",
      variables: {
        resourceType: opts.resourceType,
        resourceId: opts.resourceId,
        status: `rejected: ${reason}`,
        summary: `Your ${opts.resourceType.toUpperCase()} was not saved: ${reason}.`,
        ...(opts.link ? { link: opts.link } : {}),
      },
    }),
  });
}
