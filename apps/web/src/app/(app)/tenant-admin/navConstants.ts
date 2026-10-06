/**
 * Shared tenant-admin navigation constants.
 *
 * GAP-TENANT-ADMIN-SUBSCRIPTION-02: the subscription page and the usage page
 * both offer an "Upgrade" action but previously sent the user to two different
 * places — subscription -> /billing/plans (the PLATFORM billing admin list with
 * "+ New Plan") and usage -> /tenant-admin/plans (the tenant compare/upgrade
 * page). The tenant-admin page is the correct target for a tenant upgrading
 * their own plan, so both now use this single constant.
 */
export const PLANS_HREF = "/tenant-admin/plans";
