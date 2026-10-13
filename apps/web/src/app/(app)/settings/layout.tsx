import type { ReactNode } from "react";

/**
 * SF-20: intentionally open to every signed-in user. /settings/branding is a read-only view for
 * non-admins: theme-service GET /v1/themes/brand has no requireRole, and the page disables every
 * control and shows a notice unless the session holds an editing role (the page's own
 * BRANDING_ADMIN_ROLES; PUT /v1/themes/brand is the real authority). Redirecting would hide a
 * page the API serves, so the role check stays on the controls.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
