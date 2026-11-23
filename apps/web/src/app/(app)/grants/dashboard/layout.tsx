import type { ReactNode } from "react";
import { GrantsRoleGate } from "../RoleGate";
import { GRANTS_DASHBOARD_ROLES } from "../roles";

export default function Layout({ children }: { children: ReactNode }) {
  return <GrantsRoleGate roles={GRANTS_DASHBOARD_ROLES}>{children}</GrantsRoleGate>;
}
