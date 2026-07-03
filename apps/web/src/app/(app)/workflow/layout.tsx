import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function WorkflowLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="workflow">{children}</ModuleGate>;
}
