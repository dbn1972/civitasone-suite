import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function ContractsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="contracts">{children}</ModuleGate>;
}
