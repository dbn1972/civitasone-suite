/** Topic + event names owned by catalogue-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createProduct: "catalogue.product.create",
  updateProduct: "catalogue.product.update",
  deleteProduct: "catalogue.product.delete",
  createRate: "catalogue.rate.create",
  updateRate: "catalogue.rate.update",
  createEligibilityRule: "catalogue.eligibility.create",
  updateEligibilityRule: "catalogue.eligibility.update",
  deleteEligibilityRule: "catalogue.eligibility.delete",
  createBundle: "catalogue.bundle.create",
  updateBundle: "catalogue.bundle.update",
  deleteBundle: "catalogue.bundle.delete",

  // ─── Sprint 2 additions (additive only) ──────────────────────────────────────
  /** PC-001 — open a new draft product version. */
  openProductVersion: "catalogue.product_version.open",
  /** PC-001 — submit a draft version for approval. */
  submitProductVersion: "catalogue.product_version.submit",
  /** PC-001 — approve a pending version (maker-checker enforced). */
  approveProductVersion: "catalogue.product_version.approve",
  /** PC-001 — reject a pending version with a reason. */
  rejectProductVersion: "catalogue.product_version.reject",
  /** PC-002 — transition a product's lifecycle state. */
  transitionProductLifecycle: "catalogue.product_lifecycle.transition",
  /** PC-003 — upsert a product's regulatory metadata. */
  upsertRegulatoryMetadata: "catalogue.regulatory_metadata.upsert",
  /** PC-004 — bulk set circle/region/office availability. */
  setProductAvailability: "catalogue.product_availability.set",
  /** PC-005 — record that a rate is mastered in an external system. */
  recordRateExternalRef: "catalogue.rate_external_ref.record",
  /** PC-006 — request approval for bundle pricing. */
  requestBundleApproval: "catalogue.bundle_approval.request",
  /** PC-006 — decide a bundle pricing approval (maker-checker enforced). */
  decideBundleApproval: "catalogue.bundle_approval.decide",
  /** PC-008 — create a cross-sell rule. */
  createCrossSellRule: "catalogue.cross_sell_rule.create",
  /** PC-008 — delete a cross-sell rule. */
  deleteCrossSellRule: "catalogue.cross_sell_rule.delete",
  /** QP-001 — set a product's code / category / tax rate. */
  classifyProduct: "catalogue.product.classify",
  /** QP-002 — create a price book. */
  createPriceBook: "catalogue.price_book.create",
  /** QP-002 — update a price book. */
  updatePriceBook: "catalogue.price_book.update",
  /** QP-002 — replace a price book's entries. */
  replacePriceBookEntries: "catalogue.price_book_entries.replace",
} as const;

export const EVENTS = {
  productCreated: "catalogue.product.created",
  productUpdated: "catalogue.product.updated",
  productDeleted: "catalogue.product.deleted",
  rateCreated: "catalogue.rate.created",
  rateUpdated: "catalogue.rate.updated",
  eligibilityRuleCreated: "catalogue.eligibility.created",
  eligibilityRuleUpdated: "catalogue.eligibility.updated",
  eligibilityRuleDeleted: "catalogue.eligibility.deleted",
  bundleCreated: "catalogue.bundle.created",
  bundleUpdated: "catalogue.bundle.updated",
  bundleDeleted: "catalogue.bundle.deleted",

  // ─── Sprint 2 additions (additive only) ──────────────────────────────────────
  /**
   * PC-001 — a new draft product version was opened.
   * Payload: { productId, versionId, versionNumber, status, changeSummary }
   */
  productVersionOpened: "catalogue.product_version.opened",
  /**
   * PC-001 — a draft version entered pending_approval.
   * Payload: { productId, versionId, versionNumber, status }
   */
  productVersionSubmitted: "catalogue.product_version.submitted",
  /**
   * PC-001 — a version was approved by a checker who is not its maker.
   * Payload: { productId, versionId, versionNumber, status, makerId, checkerId, comment? }
   */
  productVersionApproved: "catalogue.product_version.approved",
  /**
   * PC-001 — a version was rejected with a reason.
   * Payload: { productId, versionId, versionNumber, status, reason, makerId, checkerId }
   */
  productVersionRejected: "catalogue.product_version.rejected",
  /**
   * PC-002 — a product's lifecycle state changed.
   * Payload: { productId, lifecycleId, fromState, toState, effectiveFrom, reason? }
   */
  productLifecycleChanged: "catalogue.product_lifecycle.changed",
  /**
   * PC-003 — a product's regulatory metadata was created or updated.
   * Payload: { productId, regulatoryId, regulation, complianceStatus, created, validUntil }
   */
  regulatoryMetadataUpserted: "catalogue.regulatory_metadata.upserted",
  /**
   * PC-004 — a product's circle/region/office availability set was replaced.
   * Payload: { productId, rowCount }
   */
  productAvailabilityChanged: "catalogue.product_availability.changed",
  /**
   * PC-005 — a rate was marked as mastered in an external system.
   * Payload: { rateId, productId, sourceSystem, externalId, syncedAt, previousVersion }
   */
  rateExternalRefRecorded: "catalogue.rate_external_ref.recorded",
  /**
   * PC-006 — bundle pricing approval requested.
   * Payload: { approvalId, bundleId, requestedBy, pricingAmountMinor (STRING paise), currency }
   */
  bundleApprovalRequested: "catalogue.bundle_approval.requested",
  /**
   * PC-006 — bundle pricing approval decided by a checker who is not the requester.
   * Payload: { approvalId, bundleId, decision, requestedBy, decidedBy, decidedAt, reason?, pricingAmountMinor (STRING paise|null) }
   */
  bundleApprovalDecided: "catalogue.bundle_approval.decided",
  /**
   * PC-008 — a cross-sell rule was created.
   * Payload: { ruleId, sourceProductId, targetProductId, ruleType, priority, enabled }
   */
  crossSellRuleCreated: "catalogue.cross_sell_rule.created",
  /**
   * PC-008 — a cross-sell rule was deleted.
   * Payload: { ruleId, sourceProductId, targetProductId, ruleType }
   */
  crossSellRuleDeleted: "catalogue.cross_sell_rule.deleted",
  /**
   * QP-001 — a product's code / category / tax rate was set.
   * Payload: { productId, productCode, category, taxRateBps (INTEGER basis points), previousVersion }
   */
  productClassified: "catalogue.product.classified",
  /**
   * QP-002 — a price book was created.
   * Payload: { priceBookId, name, segment, currency, status }
   */
  priceBookCreated: "catalogue.price_book.created",
  /**
   * QP-002 — a price book was updated.
   * Payload: { priceBookId, patch, previousVersion }
   */
  priceBookUpdated: "catalogue.price_book.updated",
  /**
   * QP-002 — a price book's entries were replaced.
   * Payload: { priceBookId, entryCount, totalAmountMinor (STRING paise) }
   */
  priceBookEntriesReplaced: "catalogue.price_book_entries.replaced",
  /**
   * Outcome of an inbound `billing.rate.change_requested`. Emitted by
   * modules/rates/consumer.ts so billing observes an answer instead of silence.
   * Acceptance records the request as valid — it does NOT move a price; applying a
   * rate stays behind the governed maker-checker rate endpoints.
   * Payload: { recordId, requestId, productId, rateId, requestedRateMinor (STRING —
   * bigint minor units), currency, effectiveFrom, outcome: "accepted" }.
   */
  rateChangeRequestAccepted: "catalogue.rate_change_request.accepted",
  /**
   * A rate change request the catalogue refused. A business rejection is an EVENT, not
   * a thrown error: throwing would retry and then dead-letter a decision that can never
   * succeed.
   * Payload: as above plus { outcome: "rejected", rejectionCode, rejectionReason }.
   */
  rateChangeRequestRejected: "catalogue.rate_change_request.rejected",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  /** billing-service may emit rate change requests requiring catalogue validation. */
  billingRateChangeRequested: "billing.rate.change_requested",
} as const;

export const SERVICE = "catalogue";
export const RESOURCE = "product";
