import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function BillingLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="billing">{children}</ModuleGate>;
}
