import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getContactById } from "../../../../_data/loaders";

const activityTypeColors: Record<string, string> = {
  call: "bg-blue-50 text-blue-700",
  meeting: "bg-purple-50 text-purple-700",
  email: "bg-slate-100 text-slate-600",
  task: "bg-amber-50 text-amber-700",
  note: "bg-emerald-50 text-emerald-700",
};

const activityStatusColors: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  overdue: "bg-red-50 text-red-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500",
};

function pill(label: string, colorClass: string) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

export default async function Page({ params }: { params: { id: string } }) {
  const { data: contact, source } = await getContactById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/crm" className="hover:text-slate-900">CRM</Link>
          <span className="mx-2">/</span>
          <Link href="/crm/contacts" className="hover:text-slate-900">Contacts</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{contact?.name ?? params.id}</span>
        </nav>

        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Contact Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {contact ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">{contact.name}</h2>
                  {contact.designation && (
                    <p className="text-sm text-slate-600">{contact.designation}</p>
                  )}
                  {contact.organization && (
                    <p className="text-sm text-slate-500">{contact.organization}</p>
                  )}
                </div>
                {contact.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {contact.tags.map((t) => (
                      <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Phone</p>
                  <p className="mt-1 text-slate-800">{contact.phone ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Email</p>
                  <p className="mt-1 text-slate-800">{contact.email ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">City</p>
                  <p className="mt-1 text-slate-800">{contact.city ?? "—"}</p>
                </div>
                {contact.lastActivityDate && (
                  <div>
                    <p className="text-xs text-slate-500">Last Activity</p>
                    <p className="mt-1 text-slate-800">{contact.lastActivityDate}</p>
                  </div>
                )}
              </div>
            </section>

            {contact.deals.length > 0 && (
              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
                  Related Deals
                </div>
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left">Deal Name</th>
                      <th className="px-4 py-3 text-left">Stage</th>
                      <th className="px-4 py-3 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contact.deals.map((deal) => (
                      <tr key={deal.id} className="border-t border-slate-200">
                        <td className="px-4 py-3">
                          <Link href={`/crm/deals/${deal.id}`} className="hover:text-indigo-600 hover:underline">
                            {deal.dealName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{deal.stage}</td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          ₹{(deal.amount / 100).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {contact.activityTimeline.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-slate-800">Activity Timeline</div>
                <div className="space-y-3">
                  {contact.activityTimeline.map((a) => (
                    <div key={a.id} className="flex items-start gap-3">
                      <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-indigo-400" />
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {pill(a.type, activityTypeColors[a.type] ?? "bg-slate-100 text-slate-600")}
                          <p className="text-sm text-slate-800">{a.subject}</p>
                          {pill(a.status, activityStatusColors[a.status] ?? "bg-slate-100 text-slate-500")}
                        </div>
                        {a.dueDate && (
                          <p className="mt-0.5 text-xs text-slate-400">Due: {a.dueDate}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Contact not found
          </div>
        )}
      </section>
    </main>
  );
}
