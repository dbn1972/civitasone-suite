import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function KnowledgeLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="knowledge">{children}</ModuleGate>;
}
