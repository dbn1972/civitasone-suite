import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getProcurementApprovals } from "../../../_data/loaders";

export default async function Page() {
  const { data: approvals, source } = await getProcurementApprovals();

  return (
    <PageShell title="Procurement Approvals" description="Pending items requiring policy and budget sign-off.">
      {source === "error" ? <DataSourceBadge source={source} /> : null}
      <div className="space-y-3">
        {approvals.map((item) => (
          <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-slate-900">
              {item.id} - {item.referenceId}
            </p>
            <p className="mt-1 text-sm text-slate-600">Owner: {item.owner}</p>
            <p className="text-sm text-slate-600">Due: {item.dueDisplay}</p>
          </article>
        ))}
      </div>
    </PageShell>
  );
}
