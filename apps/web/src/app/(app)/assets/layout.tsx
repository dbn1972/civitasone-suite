import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function AssetsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="assets">{children}</ModuleGate>;
}
