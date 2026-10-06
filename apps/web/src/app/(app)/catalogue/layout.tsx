import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole, CATALOGUE_READER_ROLES } from "@/lib/auth/roleGuard";

export default function Layout({ children }: { children: ReactNode }) {
  // GAP-CATALOGUE-HOME-02: gate the whole /catalogue route family to the same
  // reader roles catalogue-service enforces on its GET routes. The server is
  // authoritative (every read requires one of CATALOGUE_READER_ROLES); this
  // web gate redirects an unauthorised user to the dashboard instead of
  // rendering four pages of failed fetches.
  requireAnyRole(CATALOGUE_READER_ROLES);
  return <ModuleGate moduleKey="catalogue">{children}</ModuleGate>;
}
