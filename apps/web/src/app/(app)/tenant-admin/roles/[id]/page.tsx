import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getAdminRoleById } from "../../../../_data/loaders";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: role, source } = await getAdminRoleById(params.id);

  if (!role) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-4xl">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
            <span className="mx-2">/</span>
            <Link href="/tenant-admin/roles" className="hover:text-slate-900">Roles</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="mt-8 text-sm text-slate-500">Role not found.</p>
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
          <Link href="/tenant-admin/roles" className="hover:text-slate-900">Roles</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{role.name}</span>
        </nav>

        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-slate-900">{role.name}</h1>
            {role.isSystemRole ? (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">System</span>
            ) : (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Custom</span>
            )}
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Description</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{role.description ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Users Assigned</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">{role.userCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Created At</dt>
              <dd className="mt-0.5 text-sm text-slate-900">{role.createdAt.slice(0, 10)}</dd>
            </div>
          </dl>
        </article>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Permissions</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">Allowed</th>
                </tr>
              </thead>
              <tbody>
                {role.permissions.map((perm: { module: string; action: string; resource?: string; allowed: boolean }, i: number) => (
                  <tr key={i} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{perm.module}</td>
                    <td className="px-4 py-3 text-slate-700">{perm.action}</td>
                    <td className="px-4 py-3 text-slate-600">{perm.resource ?? "—"}</td>
                    <td className="px-4 py-3">
                      {perm.allowed ? (
                        <span className="text-emerald-600 font-semibold">Yes</span>
                      ) : (
                        <span className="text-red-600 font-semibold">No</span>
                      )}
                    </td>
                  </tr>
                ))}
                {role.permissions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">No permissions defined.</td>
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
