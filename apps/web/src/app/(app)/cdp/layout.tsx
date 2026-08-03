import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function Layout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="cdp">{children}</ModuleGate>;
}
