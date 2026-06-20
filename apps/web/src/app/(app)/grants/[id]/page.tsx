import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGrantById } from "../../../_data/loaders";
import type { GrantDetail } from "@civitasone/types";

const grantStatusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  completed: "bg-blue-50 text-blue-700",
  suspended: "bg-amber-50 text-amber-700",
  cancelled: "bg-red-50 text-red-700",
};

const installmentStatusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  released: "bg-blue-50 text-blue-700",
  utilized: "bg-emerald-50 text-emerald-700",
};

export default async function GrantDetailPage({ params }: { params: { id: string } }) {
  const { data: grant, source } = await getGrantById(params.id);

  if (!grant) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-7xl space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/grants" className="hover:text-slate-900">Grants</Link>
            <span className="mx-2">/</span>
            <Link href="/grants/list" className="hover:text-slate-900">Grants List</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="text-slate-500">Grant not found.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/grants" className="hover:text-slate-900">Grants</Link>
          <span className="mx-2">/</span>
          <Link href="/grants/list" className="hover:text-slate-900">Grants List</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{grant.grantNo}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-slate-900">{grant.title}</h1>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${grantStatusColors[grant.status] ?? "bg-slate-100 text-slate-600"}`}>
                {grant.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600 font-mono">{grant.grantNo}</p>
            {grant.purpose ? <p className="mt-2 text-sm text-slate-600">{grant.purpose}</p> : null}
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Grantee</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{grant.granteeName ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Amount</p>
            <p className="mt-1 text-lg font-bold text-blue-600">₹{(grant.totalAmount / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Disbursed</p>
            <p className="mt-1 text-lg font-bold text-emerald-600">₹{(grant.disbursedAmount / 100).toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-lg font-bold text-amber-600">₹{(grant.pendingAmount / 100).toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Installments</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Installment No</th>
                  <th className="px-4 py-3 text-right">Amount (₹)</th>
                  <th className="px-4 py-3">Scheduled Date</th>
                  <th className="px-4 py-3">Released Date</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {grant.installments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">No installments</td>
                  </tr>
                ) : (
                  grant.installments.map((inst: GrantDetail["installments"][number]) => (
                    <tr key={inst.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{inst.installmentNo}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(inst.amount / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-slate-600">{inst.scheduledDate}</td>
                      <td className="px-4 py-3 text-slate-600">{inst.releasedDate ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${installmentStatusColors[inst.status] ?? "bg-slate-100 text-slate-600"}`}>
                          {inst.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-base font-semibold text-slate-900">Utilisation Certificates</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">UC No</th>
                  <th className="px-4 py-3 text-right">Amount (₹)</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {grant.ucs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">No utilisation certificates</td>
                  </tr>
                ) : (
                  grant.ucs.map((uc: GrantDetail["ucs"][number]) => (
                    <tr key={uc.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-900">{uc.ucNo}</td>
                      <td className="px-4 py-3 text-right text-slate-800">₹{(uc.amount / 100).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-slate-600">{uc.period}</td>
                      <td className="px-4 py-3 text-slate-600">{uc.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
