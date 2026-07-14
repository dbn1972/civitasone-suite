import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function CourtLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="court">{children}</ModuleGate>;
}
