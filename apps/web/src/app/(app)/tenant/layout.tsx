import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function TenantLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="tenant">{children}</ModuleGate>;
}
