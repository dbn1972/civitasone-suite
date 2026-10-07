/**
 * Role sets for the /tenant web area (GAP-TENANT-HOME-01, HOME-02,
 * CONSENT-EXCHANGE-02). Kept in one place so the layout gate, the hub tile
 * visibility and the page tests all agree on a single list. These mirror the
 * tenant-admin role set used by tenant-admin/layout.tsx. The authoritative
 * control is server-side in tenant-service; these only decide what the web
 * renders / which route the user may reach.
 */
export const TENANT_ADMIN_ROLES = ["tenant_admin", "platform_admin", "super_admin"];
