import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getAuditObservationById } from "../../../../_data/loaders";

const typeColors: Record<string, string> = {
  internal: "bg-blue-50 text-blue-700",
  cag: "bg-red-50 text-red-700",
  statutory: "bg-orange-50 text-orange-700",
  concurrent: "bg-purple-50 text-purple-700",
};

const severityColors: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  major: "bg-orange-100 text-orange-800",
  minor: "bg-yellow-100 text-yellow-800",
  observation: "bg-slate-100 text-slate-600",
};

const statusColors: Record<string, string> = {
  open: "bg-red-50 text-red-700",
  replied: "bg-yellow-50 text-yellow-700",
  partially_closed: "bg-orange-50 text-orange-700",
  closed: "bg-emerald-50 text-emerald-700",
  compliance_pending: "bg-purple-50 text-purple-700",
};

export default async function AuditObservationDetailPage({ params }: { params: { id: string } }) {
  const { data: obs, source } = await getAuditObservationById(params.id);

  if (!obs) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-5xl space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/audit" className="hover:text-slate-900">Audit</Link>
            <span className="mx-2">/</span>
            <Link href="/audit/observations" className="hover:text-slate-900">Observations</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="text-slate-500">Observation not found.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/audit" className="hover:text-slate-900">Audit</Link>
          <span className="mx-2">/</span>
          <Link href="/audit/observations" className="hover:text-slate-900">Observations</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{obs.observationNo}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-bold text-slate-700">{obs.observationNo}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[obs.type] ?? "bg-slate-100 text-slate-600"}`}>
                {obs.type}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityColors[obs.severity] ?? "bg-slate-100 text-slate-600"}`}>
                {obs.severity}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[obs.status] ?? "bg-slate-100 text-slate-600"}`}>
                {obs.status.replace(/_/g, " ")}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{obs.title}</h1>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Details</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            {obs.department && (
              <>
                <dt className="text-slate-500">Department</dt>
                <dd className="text-slate-800 col-span-2 md:col-span-1">{obs.department}</dd>
              </>
            )}
            {obs.auditPeriod && (
              <>
                <dt className="text-slate-500">Audit Period</dt>
                <dd className="text-slate-800">{obs.auditPeriod}</dd>
              </>
            )}
            <dt className="text-slate-500">Raised Date</dt>
            <dd className="text-slate-800">{obs.raisedDate}</dd>
            {obs.dueDate && (
              <>
                <dt className="text-slate-500">Due Date</dt>
                <dd className="text-slate-800">{obs.dueDate}</dd>
              </>
            )}
            {obs.amount !== undefined && (
              <>
                <dt className="text-slate-500">Amount</dt>
                <dd className="text-slate-800">₹{obs.amount.toLocaleString("en-IN")}</dd>
              </>
            )}
            {obs.para && (
              <>
                <dt className="text-slate-500">Para No</dt>
                <dd className="text-slate-800">{obs.para}</dd>
              </>
            )}
          </dl>
        </section>

        {obs.description && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Description</h2>
            <p className="text-sm text-slate-700 whitespace-pre-line">{obs.description}</p>
          </section>
        )}

        {obs.recommendations && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Recommendations</h2>
            <p className="text-sm text-slate-700 whitespace-pre-line">{obs.recommendations}</p>
          </section>
        )}

        {obs.replies.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-slate-900">Replies</h2>
            <div className="space-y-4">
              {obs.replies.map((reply) => (
                <div key={reply.id} className="flex gap-4 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                  <div className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-indigo-400" />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{reply.repliedBy}</span>
                      <span className="text-xs text-slate-400">{reply.repliedAt}</span>
                      {reply.acceptedByAuditor === true && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Accepted</span>
                      )}
                      {reply.acceptedByAuditor === false && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Rejected</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{reply.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {obs.closureDetails && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Closure Details</h2>
            <p className="text-sm text-slate-700 whitespace-pre-line">{obs.closureDetails}</p>
          </section>
        )}
      </section>
    </main>
  );
}
