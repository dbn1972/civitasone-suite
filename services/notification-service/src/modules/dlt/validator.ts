/**
 * G8 DLT Compliance Validator
 *
 * Entry-point function for validating whether a message body matches a
 * DLT-registered template for the given tenant and channel.
 *
 * Called in the send path BEFORE dispatching SMS/WhatsApp messages.
 * If invalid: reject with status 'dlt_rejected', do NOT deliver.
 */
import * as repo from "./repo.js";
import { validateDltTemplate } from "./validate.js";

export interface DltComplianceResult {
  valid: boolean;
  dltTemplateId?: string;
  reason?: string;
}

/**
 * Validate DLT compliance for a message body against registered templates.
 *
 * Matches the template body against all active, non-expired DLT templates for
 * the tenant/channel combination. Returns the matched dlt_template_id for
 * inclusion in the send payload to the operator.
 *
 * @param tenantId - The tenant sending the message
 * @param channel - The channel (sms or whatsapp)
 * @param templateBody - The actual message text to validate
 * @returns Compliance result with matched template ID or rejection reason
 */
export async function validateDltCompliance(
  tenantId: string,
  channel: string,
  templateBody: string,
): Promise<DltComplianceResult> {
  // Only SMS and WhatsApp are DLT-regulated
  if (channel !== "sms" && channel !== "whatsapp") {
    return { valid: true, reason: "channel_not_regulated" };
  }

  const templates = await repo.findActiveByChannel(tenantId, channel);

  if (templates.length === 0) {
    return { valid: false, reason: "no_dlt_templates_registered" };
  }

  for (const t of templates) {
    // Skip expired templates
    if (t.expiresAt && new Date(t.expiresAt) < new Date()) {
      continue;
    }

    if (validateDltTemplate(templateBody, t.templateBody)) {
      return { valid: true, dltTemplateId: t.templateId };
    }
  }

  return { valid: false, reason: "no_matching_dlt_template" };
}
