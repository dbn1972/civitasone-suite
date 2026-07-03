import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="finance">{children}</ModuleGate>;
}
