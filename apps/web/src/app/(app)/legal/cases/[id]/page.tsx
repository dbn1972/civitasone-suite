import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getLegalCaseById } from "../../../../_data/loaders";

const typeColors: Record<string, string> = {
  civil: "bg-blue-50 text-blue-700",
  criminal: "bg-red-50 text-red-700",
  arbitration: "bg-orange-50 text-orange-700",
  tribunal: "bg-purple-50 text-purple-700",
  writ: "bg-yellow-50 text-yellow-700",
  appeal: "bg-slate-100 text-slate-600",
  other: "bg-slate-100 text-slate-600",
};

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  disposed: "bg-slate-100 text-slate-600",
  stayed: "bg-yellow-50 text-yellow-700",
  transferred: "bg-blue-50 text-blue-700",
  dismissed: "bg-red-50 text-red-700",
  settled: "bg-teal-50 text-teal-700",
};

const orderStatusColors: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  complied: "bg-emerald-50 text-emerald-700",
  appealed: "bg-blue-50 text-blue-700",
};

export default async function LegalCaseDetailPage({ params }: { params: { id: string } }) {
  const { data: caseData, source } = await getLegalCaseById(params.id);

  if (!caseData) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-5xl space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/legal" className="hover:text-slate-900">Legal</Link>
            <span className="mx-2">/</span>
            <Link href="/legal/list" className="hover:text-slate-900">Cases</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="text-slate-500">Case not found.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/legal" className="hover:text-slate-900">Legal</Link>
          <span className="mx-2">/</span>
          <Link href="/legal/list" className="hover:text-slate-900">Cases</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{caseData.caseNo}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-bold text-slate-700">{caseData.caseNo}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[caseData.type] ?? "bg-slate-100 text-slate-600"}`}>
                {caseData.type}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[caseData.status] ?? "bg-slate-100 text-slate-600"}`}>
                {caseData.status}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{caseData.title}</h1>
            <p className="mt-1 text-sm text-slate-600">{caseData.court}</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Case Details</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <dt className="text-slate-500">Filed Date</dt>
            <dd className="text-slate-800">{caseData.filedDate}</dd>
            {caseData.department && (
              <>
                <dt className="text-slate-500">Department</dt>
                <dd className="text-slate-800">{caseData.department}</dd>
              </>
            )}
            {caseData.petitioner && (
              <>
                <dt className="text-slate-500">Petitioner</dt>
                <dd className="text-slate-800">{caseData.petitioner}</dd>
              </>
            )}
            {caseData.respondent && (
              <>
                <dt className="text-slate-500">Respondent</dt>
                <dd className="text-slate-800">{caseData.respondent}</dd>
              </>
            )}
            {caseData.advocateName && (
              <>
                <dt className="text-slate-500">Advocate</dt>
                <dd className="text-slate-800">{caseData.advocateName}</dd>
              </>
            )}
            {caseData.nextHearingDate && (
              <>
                <dt className="text-slate-500">Next Hearing</dt>
                <dd className="text-slate-800 font-medium text-orange-700">{caseData.nextHearingDate}</dd>
              </>
            )}
          </dl>
        </section>

        {caseData.description && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Description</h2>
            <p className="text-sm text-slate-700 whitespace-pre-line">{caseData.description}</p>
          </section>
        )}

        {caseData.hearings.length > 0 && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Hearings</div>
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Court</th>
                  <th className="px-4 py-3">Purpose</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Next Date</th>
                </tr>
              </thead>
              <tbody>
                {caseData.hearings.map((h) => (
                  <tr key={h.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800">{h.date}</td>
                    <td className="px-4 py-3 text-slate-600">{h.court}</td>
                    <td className="px-4 py-3 text-slate-600">{h.purpose ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{h.outcome ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{h.nextDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {caseData.orders.length > 0 && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Court Orders</div>
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Order No</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3">Compliance Required</th>
                  <th className="px-4 py-3">Deadline</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {caseData.orders.map((o) => (
                  <tr key={o.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800">{o.date}</td>
                    <td className="px-4 py-3 text-slate-600">{o.orderNo ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{o.summary}</td>
                    <td className="px-4 py-3">
                      {o.complianceRequired ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Yes</span>
                      ) : (
                        <span className="text-slate-400 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{o.complianceDeadline ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${orderStatusColors[o.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </section>
    </main>
  );
}

