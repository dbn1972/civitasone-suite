import Link from "next/link";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getAuditItems } from "../../_data/loaders";

export default async function AuditPage() {
  const { data: auditItems, source } = await getAuditItems();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <span className="text-slate-900">Audit</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Audit Trail</h1>
            <p className="mt-1 text-sm text-slate-600">Recent tenant-scoped activity with outcome and resource context.</p>
          </div>
          <div className="flex items-center gap-3">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <Link href="/audit/dashboard" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
              Dashboard
            </Link>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[
            { label: "Dashboard", href: "/audit/dashboard" },
            { label: "Observations", href: "/audit/observations" },
            { label: "Risk Register", href: "/audit/risk-register" },
            { label: "Audit Plan", href: "/audit/plan" },
            { label: "Compliance", href: "/audit/compliance" },
            { label: "Export Jobs", href: "/audit/exports" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md text-sm font-medium text-slate-800"
            >
              {link.label}
            </Link>
          ))}
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Event Log</div>
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {auditItems.map((item, index) => (
                <tr key={`${item.actor}-${index}`} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800">{item.actor}</td>
                  <td className="px-4 py-3 text-slate-600">{item.action}</td>
                  <td className="px-4 py-3 text-slate-600">{item.resource}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.outcome === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {item.outcome}
                    </span>
                  </td>
                </tr>
              ))}
              {auditItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">No audit events found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
