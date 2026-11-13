/**
 * Module licence guard for this service's cross-module event consumers (module-sale gap M5).
 *
 * Topics produced by OTHER modules that this service consumes, mapped to the licence key of the module that
 * owns the consumer. When MODULE_LICENCE_CHECK=on and the tenant is in enforce mode, an event for a tenant that
 * did not buy that module is dropped (acked, logged, counted) instead of retrying into the DLQ; watch-only logs
 * and counts but delivers. Default (env unset / tenant off): untouched. See @civitasone/module-licence.
 */
import { createModuleLicence, LICENCE_MODULE } from "@civitasone/module-licence";
import { SERVICE } from "../topics.js";

export const licence = createModuleLicence({ service: SERVICE });

export const CROSS_MODULE_CONSUMERS: Readonly<Record<string, string>> = {
  "payroll.run.approved": LICENCE_MODULE.finance,
  "payroll.run.disbursed": LICENCE_MODULE.finance,
  "procurement.grn.accepted": LICENCE_MODULE.finance,
  "grant.uc.submitted": LICENCE_MODULE.finance,
  "finance.payment.eft.initiate": LICENCE_MODULE.finance,
  "revenue.receipt.captured": LICENCE_MODULE.finance,
  "revenue.refund.processed": LICENCE_MODULE.finance,
  "billing.invoice.issued": LICENCE_MODULE.finance,
  "billing.invoice.paid": LICENCE_MODULE.finance,
  "citizen.receipt.issued": LICENCE_MODULE.finance,
  "citizen.refund.approved": LICENCE_MODULE.finance,
  "meeting.decision.financial": LICENCE_MODULE.finance,
  "audit.para.pending_recovery": LICENCE_MODULE.finance,
};
