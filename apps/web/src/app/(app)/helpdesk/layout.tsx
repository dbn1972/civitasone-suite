import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function HelpdeskLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="helpdesk">{children}</ModuleGate>;
}
