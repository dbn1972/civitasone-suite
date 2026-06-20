import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getAdminUserById } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  inactive: "bg-slate-100 text-slate-600",
  suspended: "bg-red-50 text-red-700",
  pending_verification: "bg-yellow-50 text-yellow-700",
};

const sessionStatusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-slate-100 text-slate-600",
  revoked: "bg-red-50 text-red-700",
};

export default async function Page({ params }: { params: { id: string } }) {
  const { data: user, source } = await getAdminUserById(params.id);

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-4xl">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
            <span className="mx-2">/</span>
            <Link href="/tenant-admin/users" className="hover:text-slate-900">Users</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="mt-8 text-sm text-slate-500">User not found.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <Link href="/tenant-admin/users" className="hover:text-slate-900">Users</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{user.name ?? user.email}</span>
        </nav>

        <header className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold text-slate-900">{user.name ?? user.email}</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Profile</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Email</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Name</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{user.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Roles</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{user.roles.length > 0 ? user.roles.join(", ") : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">MFA Status</dt>
              <dd className="mt-0.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.mfaEnabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {user.mfaEnabled ? "Enabled" : "Disabled"}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Status</dt>
              <dd className="mt-0.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColors[user.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {user.status.replace(/_/g, " ")}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Last Login</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{user.lastLoginAt ? user.lastLoginAt.slice(0, 10) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Created At</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{user.createdAt.slice(0, 10)}</dd>
            </div>
          </dl>
        </article>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Active Sessions</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">IP Address</th>
                  <th className="px-4 py-3">Created At</th>
                  <th className="px-4 py-3">Last Active</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {user.sessions.map((session: { id: string; ipAddress?: string; createdAt: string; lastActiveAt: string; status: string }) => (
                  <tr key={session.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{session.ipAddress ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{session.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-3 text-slate-600">{session.lastActiveAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${sessionStatusColors[session.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {session.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="cursor-not-allowed text-xs text-slate-400">Revoke</span>
                    </td>
                  </tr>
                ))}
                {user.sessions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No active sessions.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
