import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGrantsDashboard, getGrants } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  completed: "bg-blue-50 text-blue-700",
  suspended: "bg-amber-50 text-amber-700",
  cancelled: "bg-red-50 text-red-700",
};

function fmtAmount(minorUnits: number) {
  return `₹${(minorUnits / 100).toLocaleString("en-IN")}`;
}

export default async function GrantsDashboardPage() {
  const [dashResult, grantsResult] = await Promise.all([
    getGrantsDashboard(),
    getGrants(),
  ]);

  const { data, source } = dashResult;
  const grants = grantsResult.data;
  const anyError = source === "error" || grantsResult.source === "error";

  const activeGrants = grants.filter((g) => g.status === "active").length;
  const sanctionedTotal = grants.reduce((sum, g) => sum + g.totalAmount, 0);
  const recentGrants = grants.slice(0, 6);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/grants" className="hover:text-slate-900">Grants</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Grants &amp; Fund Management</h1>
            <p className="mt-1 text-sm text-slate-600">Grant lifecycle, releases, utilisation and audit — one view.</p>
          </div>
          {anyError ? <DataSourceBadge source="error" /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active Grants</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{activeGrants.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Sanctioned (FY)</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{fmtAmount(sanctionedTotal)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Disbursed</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{fmtAmount(data.disbursedAmount)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">UC Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{data.pendingUCs.toLocaleString("en-IN")}</p>
          </div>
        </section>

        {recentGrants.length > 0 && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Recent Grants</p>
              <Link href="/grants/list" className="text-xs text-indigo-600 hover:underline">View all →</Link>
            </div>
            <table aria-label="Recent grants" className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left text-xs">Grant</th>
                  <th className="px-4 py-2 text-left text-xs">Grantee</th>
                  <th className="px-4 py-2 text-right text-xs">Amount</th>
                  <th className="px-4 py-2 text-left text-xs">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentGrants.map((g) => (
                  <tr key={g.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/grants/${g.id}`} className="font-medium text-indigo-600 hover:underline">
                        {g.title}
                      </Link>
                      <p className="text-xs text-slate-400 font-mono">{g.grantNo}</p>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{g.granteeName ?? "—"}</td>
                    <td className="px-4 py-2 text-right text-slate-600">{fmtAmount(g.totalAmount)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[g.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {g.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Grants List", href: "/grants/list" },
            { label: "Grantees", href: "/grants/grantees" },
            { label: "Releases", href: "/grants/releases" },
            { label: "Installments", href: "/grants/installments" },
            { label: "UC Management", href: "/grants/utilization" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md text-sm font-medium text-slate-800"
            >
              {link.label}
            </Link>
          ))}
        </section>
      </section>
    </main>
  );
}
