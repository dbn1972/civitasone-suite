import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAdminUsers } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  inactive: "bg-slate-100 text-slate-600",
  suspended: "bg-red-50 text-red-700",
  pending_verification: "bg-yellow-50 text-yellow-700",
};

export default async function Page() {
  const { data: users, source } = await getAdminUsers();

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const mfaEnabled = users.filter((u) => u.mfaEnabled).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Users</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Manage Users</h1>
            <p className="mt-1 text-sm text-slate-600">Tenant user directory with role assignment and MFA status.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Users</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Active</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{active}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Suspended</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{suspended}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">MFA Enabled</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{mfaEnabled}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Tenant users" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Email</th>
                <th scope="col" className="px-4 py-3">Roles</th>
                <th scope="col" className="px-4 py-3">Last Login</th>
                <th scope="col" className="px-4 py-3">MFA</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/tenant-admin/users/${user.id}`} className="font-medium text-indigo-600 hover:underline">
                      {user.name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{user.email}</td>
                  <td className="px-4 py-3 text-slate-600">{user.roles.length > 0 ? user.roles.join(", ") : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{user.lastLoginAt ? user.lastLoginAt.slice(0, 10) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.mfaEnabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {user.mfaEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColors[user.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {user.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {users.length === 0 && source !== "error" && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    <span className="block font-medium text-slate-700">No users yet</span>
                    <span className="mt-1 block text-slate-400">Users will appear here once added to this tenant.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
