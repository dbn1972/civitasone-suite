import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="analytics">{children}</ModuleGate>;
}
