import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAdminRoles } from "../../../_data/loaders";

export default async function Page() {
  const { data: roles, source } = await getAdminRoles();

  const total = roles.length;
  const systemRoles = roles.filter((r) => r.isSystemRole).length;
  const customRoles = roles.filter((r) => !r.isSystemRole).length;
  const totalAssigned = roles.reduce((sum, r) => sum + r.userCount, 0);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Roles</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Manage Roles</h1>
            <p className="mt-1 text-sm text-slate-600">Role definitions and assignment footprint.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Roles</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">System Roles</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{systemRoles}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Custom Roles</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{customRoles}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total Assignments</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{totalAssigned}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Tenant roles" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Description</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Users</th>
                <th scope="col" className="px-4 py-3">Created At</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/tenant-admin/roles/${role.id}`} className="font-medium text-indigo-600 hover:underline">
                      {role.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate text-slate-600">{role.description ?? "—"}</td>
                  <td className="px-4 py-3">
                    {role.isSystemRole ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">System</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Custom</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{role.userCount}</td>
                  <td className="px-4 py-3 text-slate-600">{role.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
              {roles.length === 0 && source !== "error" && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                    <span className="block font-medium text-slate-700">No roles yet</span>
                    <span className="mt-1 block text-slate-400">Role definitions will appear here once configured.</span>
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
