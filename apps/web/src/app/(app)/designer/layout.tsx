import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function DesignerLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="citizen">{children}</ModuleGate>;
}
