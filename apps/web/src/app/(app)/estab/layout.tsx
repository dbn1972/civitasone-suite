import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function EstabLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="establishment">{children}</ModuleGate>;
}
