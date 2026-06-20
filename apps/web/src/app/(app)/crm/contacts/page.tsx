import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getCrmContacts } from "../../../_data/loaders";

export default async function Page() {
  const { data: contacts, source } = await getCrmContacts();

  return (
    <PageShell title="CRM Contacts" description="Key people mapped to active and strategic accounts.">
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="tbl min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Organization</th>
              <th className="px-4 py-3 text-left">Phone</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Last Activity</th>
              <th className="px-4 py-3 text-left">Tags</th>
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No contacts</td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr key={contact.email || contact.name} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {contact.id ? (
                      <Link href={`/crm/contacts/${contact.id}`} className="hover:text-indigo-600 hover:underline">
                        {contact.name}
                      </Link>
                    ) : (
                      contact.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{contact.account}</td>
                  <td className="px-4 py-3 text-slate-600">{contact.phone || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{contact.email || "—"}</td>
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
