import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getCrmContacts } from "../../../_data/loaders";

export default async function Page() {
  const { data: contacts, source } = await getCrmContacts();

  return (
    <PageShell
      title="CRM Contacts"
      description="Key people mapped to active and strategic accounts."
      breadcrumb={
        <>
          <Link href="/crm" className="hover:text-slate-900">CRM</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Contacts</span>
        </>
      }
    >
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm" aria-label="CRM contacts list">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Name</th>
              <th scope="col" className="px-4 py-3 text-left">Organization</th>
              <th scope="col" className="px-4 py-3 text-left">Phone</th>
              <th scope="col" className="px-4 py-3 text-left">Email</th>
              <th scope="col" className="px-4 py-3 text-left">Last Activity</th>
              <th scope="col" className="px-4 py-3 text-left">Tags</th>
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-slate-500 font-medium">No contacts yet</p>
                  <p className="mt-1 text-sm text-slate-400">Add your first contact to get started.</p>
                </td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr key={contact.id ?? contact.email ?? contact.name} className="border-t border-slate-200 hover:bg-slate-50 focus-within:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {contact.id ? (
                      <Link href={`/crm/contacts/${contact.id}`} className="rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:text-indigo-600 hover:underline">
                        {contact.name}
                      </Link>
                    ) : (
                      contact.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{contact.account ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{contact.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{contact.email ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">—</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">—</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
