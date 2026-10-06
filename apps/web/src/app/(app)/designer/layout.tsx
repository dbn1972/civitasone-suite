import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function DesignerLayout({ children }: { children: ReactNode }) {
  // GAP-DESIGNER-HOME-05: designer should not be gated on the citizen module.
  // Using a dedicated 'designer' key decouples it from citizen enablement.
  // If the org profile has no "designer" entry, the lenient matching in
  // isModuleEnabled falls back to showing everything (fail-open).
  return <ModuleGate moduleKey="designer">{children}</ModuleGate>;
}
