import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function VisitorLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="visitor">{children}</ModuleGate>;
}
