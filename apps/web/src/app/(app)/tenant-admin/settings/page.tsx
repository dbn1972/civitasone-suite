import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, DataTable } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getTenantModules } from "../../../_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { ModuleToggleActions } from "./ModuleToggleActions";

export default async function TenantSettingsPage() {
  const { data: modules, source } = await getTenantModules();

  const total = modules.length;
  const enabled = modules.filter((m) => m.enabled).length;
  const disabled = modules.filter((m) => !m.enabled).length;

  return (
    <div className="wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Settings & Modules" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Settings & Modules"
        subtitle="Module configuration and toggle state for this tenant."
        actions={
          <>
            <a className="btn ghost" href="/tenant-admin/audit">Audit changes</a>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🧩" iconBg="#f1f5f9" label="Total Modules" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={enabled} />
        <StatCard icon="⏸️" iconBg="#fffaeb" label="Disabled" value={disabled} />
        <StatCard icon="⚙️" iconBg="#eff6ff" label="Configured" value={total} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-2" style={{ marginTop: 18 }}>
        <ModuleToggleActions modules={modules} />
        <div className="card">
          <div className="card-h"><h3>Module details</h3></div>
          <DataTable
            columns={[
              { key: "moduleName", label: "Module" },
              { key: "moduleKey", label: "Key" },
              { key: "enabledSince", label: "Enabled since" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={modules.map((mod) => ({
              moduleName: mod.moduleName,
              moduleKey: mod.moduleKey,
              enabledSince: mod.enabledAt ? formatIndianDate(mod.enabledAt) : "—",
              status: mod.enabled ? "Active" : "Inactive",
            }))}
            sortable
          />
        </div>
      </div>
    </div>
  );
}
