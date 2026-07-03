import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function EstablishmentLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="establishment">{children}</ModuleGate>;
}
