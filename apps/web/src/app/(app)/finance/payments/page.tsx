import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getPayments } from "../../../_data/loaders";

export default async function Page() {
  const { data: payments, source } = await getPayments();

  return (
    <PageShell title="Payments" description="Outgoing and incoming payment lifecycle tracking.">
      {source === "error" ? <DataSourceBadge source={source} /> : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-4 py-3 text-left">Reference</th>
              <th className="px-4 py-3 text-left">Beneficiary</th>
              <th className="px-4 py-3 text-left">Amount</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.referenceId} className="border-t border-slate-200">
                <td className="px-4 py-3 font-mono">{payment.referenceId}</td>
                <td className="px-4 py-3">{payment.beneficiary}</td>
                <td className="px-4 py-3">{payment.amountDisplay}</td>
                <td className="px-4 py-3">{payment.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
