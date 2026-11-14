import type { ReactNode } from "react";
import { ModuleGate } from "../../ModuleGate";

/**
 * M2: Recruitment is its own module switch (not the HR switch). The parent /hr layout
 * keeps the HR gate and role check; this adds the Recruitment gate so a tenant without
 * it gets the "module not enabled" state on every route under this segment.
 */
export default function HrRecruitmentLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="recruitment">{children}</ModuleGate>;
}
