import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabCompliance } from "../../../_data/loaders";
import type { ComplianceSummary } from "@civitasone/types";

const complianceStatusColors: Record<ComplianceSummary["status"], string> = {
  pending: "bg-amber-50 text-amber-700",
  complied: "bg-emerald-50 text-emerald-700",
  overdue: "bg-red-50 text-red-700",
  not_applicable: "bg-slate-100 text-slate-500",
};

const frequencyLabels: Record<ComplianceSummary["frequency"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  one_time: "One-time",
};

export default async function CompliancePage() {
  const { data: items, source } = await getEstabCompliance();
  const today = new Date().toISOString().split("T")[0];
  const total = items.length;
  const pending = items.filter((c) => c.status === "pending").length;
  const overdue = items.filter((c) => c.status === "overdue").length;
  const currentMonth = today.slice(0, 7);
  const compliedThisMonth = items.filter(
    (c) => c.status === "complied" && (c.lastCompliedDate ?? "").startsWith(currentMonth),
  ).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Compliance</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Action / Decision Compliance</h1>
            <p className="mt-1 text-sm text-slate-600">Track closure of meeting action items &amp; decisions.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Total", value: total, color: "text-slate-900" },
            { label: "Pending", value: pending, color: "text-amber-600" },
            { label: "Overdue", value: overdue, color: "text-red-600" },
            { label: "Complied This Month", value: compliedThisMonth, color: "text-emerald-600" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{s.label}</p>
              <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Assigned To</th>
                <th className="px-4 py-3">Last Complied</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No compliance items found</td>
                </tr>
              ) : (
                items.map((c) => (
                  <tr key={c.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-700">{c.complianceCode}</td>
                    <td className="px-4 py-3 text-slate-800">{c.title}</td>
                    <td className="px-4 py-3 text-slate-600">{c.category}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {frequencyLabels[c.frequency]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.dueDate}</td>
                    <td className="px-4 py-3 text-slate-600">{c.assignedTo ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.lastCompliedDate ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${complianceStatusColors[c.status]}`}>
                        {c.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
