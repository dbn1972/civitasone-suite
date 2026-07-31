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
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  /** billing-service may emit rate change requests requiring catalogue validation. */
  billingRateChangeRequested: "billing.rate.change_requested",
} as const;

export const SERVICE = "catalogue";
export const RESOURCE = "product";
