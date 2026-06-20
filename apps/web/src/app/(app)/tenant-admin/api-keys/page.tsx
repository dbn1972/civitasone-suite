import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAPIKeys } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-slate-100 text-slate-600",
  revoked: "bg-red-50 text-red-700",
};

function maskKey(prefix: string): string {
  return `${prefix}****`;
}

export default async function Page() {
  const { data: keys, source } = await getAPIKeys();

  const total = keys.length;
  const active = keys.filter((k) => k.status === "active").length;
  const expired = keys.filter((k) => k.status === "expired").length;
  const neverUsed = keys.filter((k) => !k.lastUsedAt).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">API Keys</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">API Keys</h1>
            <p className="mt-1 text-sm text-slate-600">Service-to-service and external API access keys.</p>
          </div>
          <div className="flex items-center gap-3">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <button
              type="button"
              disabled
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
            >
              New API Key
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Keys</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Expired</p>
            <p className="mt-1 text-2xl font-bold text-slate-500">{expired}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Never Used</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{neverUsed}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Key Name</th>
                <th className="px-4 py-3">Prefix</th>
                <th className="px-4 py-3">Created By</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3">Last Used</th>
                <th className="px-4 py-3">Expires At</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{key.keyName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{maskKey(key.keyPrefix)}</td>
                  <td className="px-4 py-3 text-slate-600">{key.createdBy}</td>
                  <td className="px-4 py-3 text-slate-600">{key.createdAt.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-slate-600">{key.lastUsedAt ? key.lastUsedAt.slice(0, 10) : "Never"}</td>
                  <td className="px-4 py-3 text-slate-600">{key.expiresAt ? key.expiresAt.slice(0, 10) : "—"}</td>
                  <td className="px-4 py-3">
                    {key.scopes.length > 0 ? (
                      <span className="text-xs text-slate-600">{key.scopes.join(", ")}</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColors[key.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {key.status}
                    </span>
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">No API keys found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
