import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

export default function EstabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:text-navy focus:px-3 focus:py-1 focus:rounded"
      >
        Skip to main content
      </a>
      <div id="main-content">
        <ModuleGate moduleKey="establishment">{children}</ModuleGate>
      </div>
    </>
  );
}
