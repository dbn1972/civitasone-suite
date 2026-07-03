import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function CitizenLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="citizen">{children}</ModuleGate>;
}
