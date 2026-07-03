import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function GrantsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="grants">{children}</ModuleGate>;
}
