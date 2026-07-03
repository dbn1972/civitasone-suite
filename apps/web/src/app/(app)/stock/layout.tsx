import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function StockLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="stock">{children}</ModuleGate>;
}
