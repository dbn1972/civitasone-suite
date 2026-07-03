import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function HrLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="hrms">{children}</ModuleGate>;
}
