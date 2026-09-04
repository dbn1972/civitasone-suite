/**
 * G8 DLT guard — invoked in the send path BEFORE dispatching SMS/WhatsApp.
 * Looks up active DLT templates for the tenant + channel and attempts to match
 * the message body against one of the registered patterns.
 *
 * If no match is found, the message is rejected with DLT_TEMPLATE_NOT_REGISTERED.
 */
import * as repo from "./repo.js";
import { validateDltTemplate } from "./validate.js";
import type { db } from "../../shared/db.js";

export interface DltCheckResult {
  passed: boolean;
  matchedTemplateId?: string;
}

const DLT_CHANNELS = new Set(["sms", "whatsapp"]);

/**
 * Returns true if the given channel requires DLT template validation.
 */
export function requiresDlt(channel: string): boolean {
  return DLT_CHANNELS.has(channel);
}

/**
 * Check if the message body matches any active DLT template for this tenant + channel.
 * Returns { passed: true, matchedTemplateId } on success, { passed: false } on failure.
 *
 * Takes the caller's ALREADY-OPEN transaction and reads through it directly
 * instead of opening a second, nested one -- see `quota-guard.ts`'s
 * `checkQuota` for the pool-exhaustion deadlock this avoids (`checkDlt` is
 * called from the exact same `processSend` send transaction).
 */
export async function checkDlt(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  channel: string,
  messageBody: string,
): Promise<DltCheckResult> {
  const templates = await repo.findActiveByChannelInTx(tx, tenantId, channel);

  for (const t of templates) {
    if (validateDltTemplate(messageBody, t.templateBody)) {
      return { passed: true, matchedTemplateId: t.templateId };
    }
  }

  return { passed: false };
}
