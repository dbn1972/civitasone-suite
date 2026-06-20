import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";

export default async function KnowledgeDashboardPage() {
  const { data: docs, source } = await getKnowledgeDocs();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const total = docs.length;
  const recent = docs.filter((d) => new Date(d.createdAt) >= thirtyDaysAgo).length;
  const pendingApproval = docs.filter((d) => d.status === "under_review").length;
  const categories = new Set(docs.map((d) => d.category)).size;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/knowledge" className="hover:text-slate-900">Knowledge</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Knowledge & Document Management</h1>
            <p className="mt-1 text-sm text-slate-600">Digital repository, records retention, and enterprise search.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Documents</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Recent (30d)</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{recent}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending Approval</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pendingApproval}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Categories</p>
            <p className="mt-1 text-2xl font-bold text-purple-600">{categories}</p>
          </div>
        </section>

        {total === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-slate-400">No documents in the repository yet.</p>
          </div>
        ) : (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-800">Recent Documents</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Author</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.slice(0, 10).map((doc) => (
                    <tr key={doc.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{doc.title}</td>
                      <td className="px-4 py-3 text-slate-600">{doc.category}</td>
                      <td className="px-4 py-3 text-slate-600">{doc.author ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{doc.createdAt}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                          doc.status === "approved" ? "bg-emerald-50 text-emerald-700" :
                          doc.status === "under_review" ? "bg-amber-50 text-amber-700" :
                          doc.status === "archived" ? "bg-slate-100 text-slate-500" :
                          "bg-slate-100 text-slate-600"
                        }`}>
                          {doc.status.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[
            { label: "Repository", href: "/knowledge/repository" },
            { label: "Records Management", href: "/knowledge/records" },
            { label: "Search", href: "/knowledge/search" },
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
