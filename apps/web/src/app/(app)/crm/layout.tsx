import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function CrmLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="crm">{children}</ModuleGate>;
}
