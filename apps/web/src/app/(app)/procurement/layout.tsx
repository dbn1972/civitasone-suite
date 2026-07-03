import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function ProcurementLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="procurement">{children}</ModuleGate>;
}
