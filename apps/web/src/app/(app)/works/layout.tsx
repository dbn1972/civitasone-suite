import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function WorksLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="works">{children}</ModuleGate>;
}
