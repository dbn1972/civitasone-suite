import type { ReactNode } from "react";

/**
 * SF-20: intentionally open to every signed-in user. /dashboard is the landing page and the
 * redirect target of every role gate in this app (requireAnyRole sends refused users here), so
 * gating it would loop. The app shell already requires a session; the tiles inside are filtered
 * per role and per enabled module (visibleModules.ts).
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
