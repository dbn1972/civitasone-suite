import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getNotificationPreferences } from "../../../_data/loaders";

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${value ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      {value ? "Yes" : "No"}
    </span>
  );
}

export default async function Page() {
  const { data: prefs, source } = await getNotificationPreferences();

  const total = prefs.length;
  const emailEnabled = prefs.filter((p) => p.emailEnabled).length;
  const smsEnabled = prefs.filter((p) => p.smsEnabled).length;
  const webhookEnabled = prefs.filter((p) => p.webhookEnabled).length;

  const byModule = prefs.reduce<Record<string, typeof prefs>>((acc, p) => {
    const key = p.module;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Notification Preferences</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Notification Preferences</h1>
            <p className="mt-1 text-sm text-slate-600">Channel configuration for each event type across all modules.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Event Types</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Email Enabled</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{emailEnabled}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">SMS Enabled</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{smsEnabled}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Webhook Enabled</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{webhookEnabled}</p>
          </div>
        </section>

        {Object.entries(byModule).map(([module, modulePeers]) => (
          <section key={module}>
            <h2 className="text-base font-semibold text-slate-900 capitalize">{module.replace(/_/g, " ")}</h2>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table aria-label={`${module.replace(/_/g, " ")} notification preferences`} className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th scope="col" className="px-4 py-3">Event Type</th>
                    <th scope="col" className="px-4 py-3">Label</th>
                    <th scope="col" className="px-4 py-3">Email</th>
                    <th scope="col" className="px-4 py-3">SMS</th>
                    <th scope="col" className="px-4 py-3">In-App</th>
                    <th scope="col" className="px-4 py-3">Webhook</th>
                  </tr>
                </thead>
                <tbody>
                  {modulePeers.map((pref) => (
                    <tr key={pref.id} className="border-t border-slate-200 hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{pref.eventType}</td>
                      <td className="px-4 py-3 text-slate-800">{pref.label}</td>
                      <td className="px-4 py-3"><YesNo value={pref.emailEnabled} /></td>
                      <td className="px-4 py-3"><YesNo value={pref.smsEnabled} /></td>
                      <td className="px-4 py-3"><YesNo value={pref.inAppEnabled} /></td>
                      <td className="px-4 py-3"><YesNo value={pref.webhookEnabled} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {prefs.length === 0 && source !== "error" && (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="text-sm font-medium text-slate-700">No notification preferences configured</p>
            <p className="mt-1 text-sm text-slate-400">Event channel settings will appear here once modules are enabled.</p>
          </div>
        )}
      </section>
    </main>
  );
}
