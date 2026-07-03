/** Topic + event names owned by tenant-service. {service}.{entity}.{action} */
export const COMMANDS = {
  // ── tenant ─────────────────────────────────────────────────────────
  createTenant: "tenant.tenant.create",
  updateTenant: "tenant.tenant.update",
  suspendTenant: "tenant.tenant.suspend",
  onboardTenant: "tenant.tenant.onboard",
  setIsolation: "tenant.tenant.set_isolation",
  // ── plans ──────────────────────────────────────────────────────────
  planCreate: "tenant.plan.create",
  planUpdate: "tenant.plan.update",
  // ── subscriptions ──────────────────────────────────────────────────
  subscriptionCreate: "tenant.subscription.create",
  subscriptionUpgrade: "tenant.subscription.upgrade",
  subscriptionCancel: "tenant.subscription.cancel",
  subscriptionRenew: "tenant.subscription.renew",
  subscriptionSuspend: "tenant.subscription.suspend",
  // ── self-service subscription ──────────────────────────────────────────
  subscriptionUpgradeInitiate: "tenant.subscription.upgrade_initiate",
  subscriptionDowngrade: "tenant.subscription.downgrade",
  subscriptionCancelSelf: "tenant.subscription.cancel_self",
  // ── quotas ─────────────────────────────────────────────────────────
  quotaSet: "tenant.quota.set",
  quotaIncrement: "tenant.quota.increment",
  // ── settings ───────────────────────────────────────────────────────
  settingUpsert: "tenant.setting.upsert",
  settingDelete: "tenant.setting.delete",
} as const;

export const EVENTS = {
  // ── tenant ─────────────────────────────────────────────────────────
  tenantCreated: "tenant.tenant.created",
  tenantUpdated: "tenant.tenant.updated",
  tenantSuspended: "tenant.tenant.suspended",
  tenantOnboarded: "tenant.tenant.onboarded",
  tenantIsolationChanged: "tenant.tenant.isolation_changed",
  // ── plans ──────────────────────────────────────────────────────────
  planCreated: "tenant.plan.created",
  planUpdated: "tenant.plan.updated",
  // ── subscriptions ──────────────────────────────────────────────────
  subscriptionCreated: "tenant.subscription.created",
  subscriptionUpgraded: "tenant.subscription.upgraded",
  subscriptionCancelled: "tenant.subscription.cancelled",
  subscriptionRenewed: "tenant.subscription.renewed",
  subscriptionSuspended: "tenant.subscription.suspended",
  // ── self-service subscription ──────────────────────────────────────────
  subscriptionUpgradeInitiated: "tenant.subscription.upgrade_initiated",
  subscriptionDowngraded: "tenant.subscription.downgraded",
  subscriptionCancelledSelf: "tenant.subscription.cancelled_self",
  // ── quotas ─────────────────────────────────────────────────────────
  quotaSet: "tenant.quota.set_done",
  quotaIncremented: "tenant.quota.incremented",
  // ── settings ───────────────────────────────────────────────────────
  settingUpserted: "tenant.setting.upserted",
  settingDeleted: "tenant.setting.deleted",
} as const;

export const SERVICE = "tenant";
export const RESOURCE = "tenant";
