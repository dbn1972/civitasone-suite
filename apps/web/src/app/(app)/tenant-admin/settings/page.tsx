import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getTenantModules } from "../../../_data/loaders";

export default async function Page() {
  const { data: modules, source } = await getTenantModules();

  const enabled = modules.filter((m) => m.enabled).length;
  const disabled = modules.filter((m) => !m.enabled).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Settings &amp; Modules</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Settings &amp; Modules</h1>
            <p className="mt-1 text-sm text-slate-600">Module configuration and toggle state for this tenant.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Modules</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{modules.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{enabled}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Disabled</p>
            <p className="mt-1 text-2xl font-bold text-slate-500">{disabled}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Module Key</th>
                <th className="px-4 py-3">Module Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Enabled At</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((mod) => (
                <tr key={mod.moduleKey} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{mod.moduleKey}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{mod.moduleName}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${mod.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {mod.enabled ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{mod.enabledAt ? mod.enabledAt.slice(0, 10) : "—"}</td>
                </tr>
              ))}
              {modules.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">No modules configured.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
