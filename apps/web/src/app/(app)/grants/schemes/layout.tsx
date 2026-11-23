import type { ReactNode } from "react";
import { GrantsRoleGate } from "../RoleGate";
import { GRANTS_SCHEME_READ_ROLES } from "../roles";

export default function Layout({ children }: { children: ReactNode }) {
  return <GrantsRoleGate roles={GRANTS_SCHEME_READ_ROLES}>{children}</GrantsRoleGate>;
}
