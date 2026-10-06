import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";

/**
 * GAP-FLEET-HOME-03: /fleet and /fleet/vehicles are a thin hub over the Assets
 * fleet screens (asset-service owns vehicles, maintenance and devices). Without
 * a layout gate a tenant that disabled the Assets module could still open
 * /fleet and /fleet/vehicles, even though the sibling /assets/* routes they
 * link to are gated by assets/layout.tsx's ModuleGate. Gate /fleet on the same
 * "assets" module key so a disabled-Assets tenant sees the same "Module Not
 * Enabled" page here as it does under /assets.
 */
export default function FleetLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="assets">{children}</ModuleGate>;
}
