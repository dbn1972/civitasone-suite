import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getSubscription } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-600",
  trial: "bg-yellow-50 text-yellow-700",
};

function formatCurrency(amount: number, currency: string): string {
  if (currency === "INR") return `₹${amount.toLocaleString("en-IN")}`;
  return `${currency} ${amount.toLocaleString()}`;
}

export default async function Page() {
  const { data: subscription, source } = await getSubscription();

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/tenant-admin" className="hover:text-slate-900">Tenant Admin</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Subscription</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Subscription</h1>
            <p className="mt-1 text-sm text-slate-600">Billing plan, limits, and module access for this tenant.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {subscription ? (
          <>
            <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">{subscription.plan}</h2>
                  {subscription.billingEmail ? (
                    <p className="mt-1 text-sm text-slate-500">Billing: {subscription.billingEmail}</p>
                  ) : null}
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${statusColors[subscription.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {subscription.status.replace(/_/g, " ")}
                </span>
              </div>

              <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs text-slate-500">Period Start</dt>
                  <dd className="mt-0.5 text-sm text-slate-900">{subscription.currentPeriodStart.slice(0, 10)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Period End</dt>
                  <dd className="mt-0.5 text-sm text-slate-900">{subscription.currentPeriodEnd.slice(0, 10)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Amount</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                    {subscription.amount != null ? formatCurrency(subscription.amount, subscription.currency) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">User Limit</dt>
                  <dd className="mt-0.5 text-sm text-slate-900">
                    {subscription.userLimit != null ? subscription.userLimit.toLocaleString("en-IN") : "Unlimited"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Active Users</dt>
                  <dd className="mt-0.5 text-sm text-slate-900">{subscription.activeUsers.toLocaleString("en-IN")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Currency</dt>
                  <dd className="mt-0.5 text-sm text-slate-900">{subscription.currency}</dd>
                </div>
              </dl>
            </article>

            {subscription.moduleAccess.length > 0 ? (
              <section>
                <h2 className="text-base font-semibold text-slate-900">Module Access</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {subscription.moduleAccess.map((mod: string) => (
                    <li key={mod} className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm text-indigo-700">
                      {mod}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-slate-400">No subscription data available.</p>
          </div>
        )}
      </section>
    </main>
  );
}
