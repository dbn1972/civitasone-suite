import { PageHeader, StatCard, DataTable, Card, RefreshErrorState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getTenantModules } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { Breadcrumb } from "../Breadcrumb";
import { ModuleToggleActions } from "./ModuleToggleActions";

export default async function TenantSettingsPage() {
  const result = await getTenantModules();
  const { data: modules } = result;
  const errored = toResourceState(result).status === "error";

  const total = modules.length;
  const enabled = modules.filter((m) => m.enabled).length;
  const disabled = modules.filter((m) => !m.enabled).length;

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Settings & Modules" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Settings & Modules"
        subtitle="Module configuration and toggle state for this tenant."
        actions={
          <>
            {/* GAP-TENANT-ADMIN-SETTINGS-06: the tenant audit page takes no
                filter params today, so this is an honest "view the log" link,
                not a filtered one. */}
            <a className="btn ghost" href="/tenant-admin/audit" style={{ minHeight: 44 }}>View audit log</a>
          </>
        }
      />
      {/* GAP-TENANT-ADMIN-SETTINGS-04: one vocabulary — "Enabled"/"Disabled"
          — across tiles, toggle pill and the details table. The old
          "Configured" tile was always == Total Modules, carrying no
          information, so it is removed (three honest tiles). */}
      <div className="grid g-3" style={{ marginBottom: 18 }}>
        <StatCard icon="🧩" iconBg="#f1f5f9" label="Total Modules" value={errored ? "—" : total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Enabled" value={errored ? "—" : enabled} />
        <StatCard icon="⏸️" iconBg="#fffaeb" label="Disabled" value={errored ? "—" : disabled} />
      </div>
      {errored ? (
        <Card title="Module toggles">
          <RefreshErrorState error={toHumanError("load", { area: "modules" })} backHref="/tenant-admin" />
        </Card>
      ) : (
        <div className="grid g-2" style={{ marginTop: 18 }} id="modules">
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
                status: mod.enabled ? "Enabled" : "Disabled",
              }))}
              sortable
            />
          </div>
        </div>
      )}
    </div>
  );
}
