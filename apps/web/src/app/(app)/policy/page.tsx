import { ModuleHub } from "../../_components/ModuleHub";

export default function PolicyHubPage() {
  return (
    <ModuleHub
      title="Policy"
      description="RBAC bindings, ABAC rules, permission evaluation and role-feature visibility."
      links={[
        { href: "/tenant-admin/roles", label: "Roles", note: "Role catalogue and permission grids (existing)" },
        { href: "/policy/bindings", label: "Bindings", note: "User ↔ role bindings and break-glass" },
        { href: "/policy/abac", label: "ABAC Rules", note: "Attribute-based allow/deny rules" },
        { href: "/policy/evaluate", label: "Evaluate", note: "Test a permission decision" },
        { href: "/policy/role-features", label: "Role Features", note: "Feature visibility grants per role" },
      ]}
    />
  );
}
