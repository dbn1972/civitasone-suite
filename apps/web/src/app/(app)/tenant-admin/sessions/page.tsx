import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getActiveSessions } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-slate-100 text-slate-600",
  revoked: "bg-red-50 text-red-700",
};

export default async function Page() {
  const { data: sessions, source } = await getActiveSessions();

  const total = sessions.length;
  const active = sessions.filter((s) => s.status === "active").length;
  const expired = sessions.filter((s) => s.status === "expired").length;
  const mfaVerified = sessions.filter((s) => s.mfaVerified).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Sessions</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Sessions</h1>
            <p className="mt-1 text-sm text-slate-600">All active and recent user sessions for this tenant.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Sessions</p>
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
            <p className="text-sm text-slate-500">MFA Verified</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{mfaVerified}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">User Email</th>
                <th className="px-4 py-3">User Name</th>
                <th className="px-4 py-3">IP Address</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3">Last Active</th>
                <th className="px-4 py-3">Expires At</th>
                <th className="px-4 py-3">MFA</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800">{session.userEmail}</td>
                  <td className="px-4 py-3 text-slate-600">{session.userName ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{session.ipAddress ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{session.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-3 text-slate-600">{session.lastActiveAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-3 text-slate-600">{session.expiresAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${session.mfaVerified ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {session.mfaVerified ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColors[session.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {session.status}
                    </span>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">No sessions found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
