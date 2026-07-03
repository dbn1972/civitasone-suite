import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="reports">{children}</ModuleGate>;
}
