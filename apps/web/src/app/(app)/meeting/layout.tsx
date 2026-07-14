import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function MeetingLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="meeting">{children}</ModuleGate>;
}
