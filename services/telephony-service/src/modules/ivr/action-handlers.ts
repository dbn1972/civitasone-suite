/**
 * Gaps 6 & 7 — IVR action handlers.
 *
 * Gap 6: On a configured IVR option selection, publish `crm.lead.inbound_capture`
 *         to create a lead from caller ID + IVR selection data.
 * Gap 7: On a configured IVR option selection, publish `notification.send`
 *         to send an SMS to the caller.
 */
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";

export interface IvrActionConfig {
  /** The DTMF digit that triggers this action. */
  digit: string;
  /** The action type. */
  action: "create_lead" | "send_sms";
  /** For send_sms: the notification template to use. */
  templateId?: string;
  /** For create_lead: default lead source. */
  leadSource?: string;
}

export interface IvrActionContext {
  tenantId: string;
  callId: string;
  callerId: string;
  callerNumber: string;
  didNumber: string | undefined;
  correlationId: string;
  ivrSelection: string;
}

/**
 * Gap 6: Publish crm.lead.inbound_capture when an IVR action is configured
 * to create a lead from caller information.
 */
export async function handleCreateLead(
  q: Queue,
  ctx: IvrActionContext,
  config: IvrActionConfig,
): Promise<void> {
  const messageId = `ivr-lead:${ctx.callId}:${ctx.ivrSelection}:${randomUUID()}`;
  await q.publish("crm.lead.inbound_capture", {
    messageId,
    type: "crm.lead.inbound_capture",
    tenantId: ctx.tenantId,
    actorId: "system",
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      channel: "telephony",
      source: "ivr",
      phone: ctx.callerNumber,
      callId: ctx.callId,
      didNumber: ctx.didNumber ?? null,
      ivrSelection: ctx.ivrSelection,
      leadSource: config.leadSource ?? "ivr_inbound",
      attributes: {
        callerId: ctx.callerId,
        ivrDigit: ctx.ivrSelection,
      },
    },
  });
}

/**
 * Gap 7: Publish notification.send when an IVR action is configured
 * to send an SMS confirmation/info to the caller.
 */
export async function handleSendSms(
  q: Queue,
  ctx: IvrActionContext,
  config: IvrActionConfig,
): Promise<void> {
  if (!config.templateId) {
    throw new Error("templateId is required for send_sms IVR action");
  }

  const messageId = `ivr-sms:${ctx.callId}:${ctx.ivrSelection}:${randomUUID()}`;
  await q.publish("notification.send", {
    messageId,
    type: "notification.send",
    tenantId: ctx.tenantId,
    actorId: "system",
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      recipientId: ctx.callerId,
      recipientPhone: ctx.callerNumber,
      channel: "sms",
      templateId: config.templateId,
      source: "ivr",
      callId: ctx.callId,
    },
  });
}

/**
 * Dispatch an IVR action based on configuration.
 */
export async function dispatchIvrAction(
  q: Queue,
  ctx: IvrActionContext,
  config: IvrActionConfig,
): Promise<void> {
  switch (config.action) {
    case "create_lead":
      await handleCreateLead(q, ctx, config);
      break;
    case "send_sms":
      await handleSendSms(q, ctx, config);
      break;
    default:
      // Unknown action type — skip silently
      break;
  }
}
