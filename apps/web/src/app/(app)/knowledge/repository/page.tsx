import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  under_review: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  archived: "bg-slate-100 text-slate-500",
};

const accessColors: Record<string, string> = {
  public: "bg-emerald-50 text-emerald-700",
  internal: "bg-blue-50 text-blue-700",
  restricted: "bg-amber-50 text-amber-700",
  confidential: "bg-red-50 text-red-700",
};

export default async function KnowledgeRepositoryPage() {
  const { data: docs, source } = await getKnowledgeDocs();

  const total = docs.length;
  const approved = docs.filter((d) => d.status === "approved").length;
  const pendingReview = docs.filter((d) => d.status === "under_review").length;
  const archived = docs.filter((d) => d.status === "archived").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/knowledge" className="hover:text-slate-900">Knowledge</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Repository</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Document Repository</h1>
            <p className="mt-1 text-sm text-slate-600">Policies, circulars, manuals, and official records.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section aria-label="Repository statistics" className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Approved</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{approved.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending Review</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pendingReview.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Archived</p>
            <p className="mt-1 text-2xl font-bold text-slate-500">{archived.toLocaleString("en-IN")}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Document repository" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Doc ID</th>
                <th scope="col" className="px-4 py-3">Title</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3">Author</th>
                <th scope="col" className="px-4 py-3">Version</th>
                <th scope="col" className="px-4 py-3">Created</th>
                <th scope="col" className="px-4 py-3">Tags</th>
                <th scope="col" className="px-4 py-3">Access</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    No documents found in the repository.
                  </td>
                </tr>
              ) : (
                docs.map((doc) => (
                  <tr key={doc.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {doc.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 max-w-xs truncate" title={doc.title}>
                      {doc.title}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{doc.category}</td>
                    <td className="px-4 py-3 text-slate-600">{doc.author ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{doc.version}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{doc.createdAt}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {doc.tags.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          doc.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                              {tag}
                            </span>
                          ))
                        )}
                        {doc.tags.length > 3 && (
                          <span className="text-xs text-slate-400">+{doc.tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${accessColors[doc.accessLevel] ?? "bg-slate-100 text-slate-600"}`}>
                        {doc.accessLevel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[doc.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {doc.status.replace("_", " ")}
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
