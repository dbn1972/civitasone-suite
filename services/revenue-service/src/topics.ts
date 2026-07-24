/**
 * Topic + event names owned by revenue-service. Naming: {service}.{entity}.{action}
 *
 * This file is the single source of truth for the revenue-service message contract.
 * - COMMANDS         — write intents published by routes (route → zod → queue.publish → 202)
 * - EVENTS           — domain facts published via the transactional outbox after a DB write
 * - CONSUMED_EVENTS  — events owned by OTHER services that revenue-service subscribes to
 *
 * _Requirements: SVC-131 through SVC-139_
 */

/** Service identifier — first segment of every owned topic name. */
export const SERVICE = "revenue";

export const COMMANDS = {
  // ── Rate Engine (SVC-136) ────────────────────────────────────────────────
  /** payload: { code, name, category: "property_tax"|"water"|"sewerage"|..., unitOfMeasure? } */
  rateHeadCreate: "revenue.rate_head.create",
  /** payload: { rateHeadId, slabType: "flat"|"band"|"ad_valorem", bandFrom?, bandTo?, rateValue (bigint string), effectiveFrom, effectiveTo?, unitOfMeasure? } */
  rateSlabCreate: "revenue.rate_slab.create",
  /** payload: { rateHeadId, interestType: "simple"|"compound", annualRateBps, graceDays, capMonths?, roundingMode? } */
  penaltyRuleCreate: "revenue.penalty_rule.create",
  /** payload: { rateHeadId, rebateType: "early_payment"|"category", discountBps, validUntilDaysBeforeDue? } */
  rebateRuleCreate: "revenue.rebate_rule.create",

  // ── Assessee (SVC-131) ───────────────────────────────────────────────────
  /** payload: { assesseeType: "property"|"water_connection", identifierNo, ownerName, address, wardNo?, zoneNo?, connectionSize?, propertyType?, builtUpArea? } */
  assesseeCreate: "revenue.assessee.create",
  /** payload: { assesseeId, version, patch } */
  assesseeUpdate: "revenue.assessee.update",

  // ── Assessment (SVC-131) ─────────────────────────────────────────────────
  /** payload: { assesseeId, rateHeadId, financialYear, baseValue (bigint string), exemptions?: string[] } */
  assessmentCreate: "revenue.assessment.create",
  /** payload: { assessmentId, version, reason, newBaseValue? (bigint string), newExemptions? } */
  assessmentRevise: "revenue.assessment.revise",
  /** payload: { assessmentId, version, reason, remissionPercent? } — maker step */
  assessmentRemit: "revenue.assessment.remit",
  /** payload: { assessmentId, approvalId, approve: boolean, reason? } — checker step */
  assessmentRemitDecide: "revenue.assessment.remit_decide",

  // ── Billing (SVC-132) ────────────────────────────────────────────────────
  /** payload: { assessmentId } — generates a bill from the demand snapshot */
  billGenerate: "revenue.bill.generate",

  // ── Collection (SVC-133 + SVC-135) ───────────────────────────────────────
  /** payload: { assesseeId, demandId, amountMinor (bigint string), channel: "online"|"counter"|"cheque"|"dd"|"pos", reference?, instrumentNo?, bankName? } */
  receiptCreate: "revenue.receipt.create",
  /** payload: { receiptId, reason, approvedBy? } — refund, maker step */
  refundCreate: "revenue.refund.create",
  /** payload: { refundId, approvalId, approve: boolean, reason? } — checker step */
  refundDecide: "revenue.refund.decide",
  /** payload: { assesseeId, fromDemandId, toDemandId, amountMinor (bigint string), reason } */
  adjustmentCreate: "revenue.adjustment.create",

  // ── Arrears & Recovery (SVC-137) ─────────────────────────────────────────
  /** payload: { assesseeId, instalmentCount, startDate } — create instalment plan from outstanding */
  instalmentPlanCreate: "revenue.instalment.create",
  /** payload: { assesseeId, amountMinor (bigint string), reason } — maker step */
  writeOffCreate: "revenue.write_off.create",
  /** payload: { writeOffId, approvalId, approve: boolean, reason? } — checker step */
  writeOffDecide: "revenue.write_off.decide",
  /** payload: { assesseeId, reason } — refer to legal-service */
  recoveryRefer: "revenue.recovery.refer",

  // ── BBPS Biller (SVC-134) ────────────────────────────────────────────────
  /** payload: { assesseeIdentifier } — returns outstanding via DCB */
  bbpsFetchBill: "revenue.bbps.fetch_bill",
  /** payload: { assesseeIdentifier, amountMinor (bigint string), bbpsTxnId, channel } */
  bbpsPayBill: "revenue.bbps.pay_bill",
} as const;

export const EVENTS = {
  // ── Rate Engine ──────────────────────────────────────────────────────────
  rateHeadCreated: "revenue.rate_head.created",
  rateSlabCreated: "revenue.rate_slab.created",
  penaltyRuleCreated: "revenue.penalty_rule.created",
  rebateRuleCreated: "revenue.rebate_rule.created",

  // ── Assessment ───────────────────────────────────────────────────────────
  assesseeCreated: "revenue.assessee.created",
  assessmentCreated: "revenue.assessment.created",
  /** Demand raised — triggers receivable GL posting in finance-service */
  demandRaised: "revenue.demand.raised",
  assessmentRevised: "revenue.assessment.revised",
  assessmentRemitted: "revenue.assessment.remitted",

  // ── Billing ──────────────────────────────────────────────────────────────
  billGenerated: "revenue.bill.generated",

  // ── Collection ───────────────────────────────────────────────────────────
  /** Receipt captured — triggers collection GL posting in finance + bank recon matching */
  receiptCaptured: "revenue.receipt.captured",
  refundProcessed: "revenue.refund.processed",
  adjustmentApplied: "revenue.adjustment.applied",

  // ── Arrears ──────────────────────────────────────────────────────────────
  instalmentPlanCreated: "revenue.instalment.created",
  writeOffApplied: "revenue.write_off.applied",
  /** Recovery referred — triggers legal-service case creation */
  recoveryReferred: "revenue.recovery.referred",
} as const;

/** Topics consumed from other services */
export const CONSUMED_EVENTS = {
  /** finance-service: bank settlement reconciliation result */
  bankStatementReconciled: "finance.bank_statement.reconciled",
} as const;
