import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function TelephonyLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="telephony">{children}</ModuleGate>;
}
