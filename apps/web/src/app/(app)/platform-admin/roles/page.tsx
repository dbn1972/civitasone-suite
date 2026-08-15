import { PageHeader, StatCard } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { RolePermissionsMatrix } from "./RolePermissionsMatrix";

export default function RolesPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "Roles & Permissions" }]} />
      <PageHeader
        back="/platform-admin"
        title="Roles & Permissions"
        subtitle="Per-role permission matrix with SoD enforcement (GFR 2017). Toggle cells to grant or revoke. System roles are read-only."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🔑" iconBg="#eff6ff" label="Platform roles" value={9} />
        <StatCard icon="🧩" iconBg="#ecfdf3" label="Modules" value={8} />
        <StatCard icon="⚡" iconBg="#f1f5f9" label="Actions / module" value={6} />
        <StatCard icon="🛡️" iconBg="#fffaeb" label="SoD constraints" value="Active" />
      </div>
      <RolePermissionsMatrix />
    </main>
  );
}
