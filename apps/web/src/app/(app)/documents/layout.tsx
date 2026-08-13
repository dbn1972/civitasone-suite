import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function DocumentsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="documents">{children}</ModuleGate>;
}
