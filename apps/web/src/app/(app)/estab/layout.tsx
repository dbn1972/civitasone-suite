import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function EstabLayout({ children }: { children: ReactNode }) {
  // UAT-P2-D3 (A11Y-16): the root layout already renders the one "Skip to content"
  // link (to <main id="main">); a second skip link inside <main> was a duplicate stop.
  return (
    <div id="main-content">
      <ModuleGate moduleKey="establishment">{children}</ModuleGate>
    </div>
  );
}
