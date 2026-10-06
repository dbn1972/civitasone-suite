import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

/**
 * GAP-LEARNING-HOME-04: wrap every /learning route in the module entitlement
 * gate so a tenant with HRMS disabled sees "Module Not Enabled" instead of
 * serving the full learning tree via a direct URL. Sidebar already hides the
 * link via moduleKey "hrms" (Sidebar.tsx), but direct navigation still
 * reached these pages. Mirrors hr/layout.tsx.
 *
 * Role gating is intentionally omitted at the layout level: the learning
 * module is accessible to employees (for self-service my-learning,
 * competency, calendar) as well as HR admins. Individual pages and the
 * backend enforce finer-grained role checks per action.
 */
export default function LearningLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="hrms">{children}</ModuleGate>;
}
