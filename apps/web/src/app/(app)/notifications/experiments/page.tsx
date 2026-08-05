import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, DataTable, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getNotificationExperiments } from "../../../_data/loaders";
import { needsApproval, rankExperiments, statusLabel } from "./experiments";

export const dynamic = "force-dynamic";

type Row = { id: string; name: string; status: string; winner: string };

export default async function ExperimentsPage() {
  const { data, source } = await getNotificationExperiments();
  const ranked = rankExperiments(data);
  const awaiting = data.filter((e) => needsApproval(e.status)).length;

  const rows: Row[] = ranked.map((e) => ({
    id: e.id,
    name: e.name,
    status: e.status,
    winner: e.winnerVariantId ?? "—",
  }));

  return (
    <>
      <PageHeader
        title="A/B & MVT Experiments"
        subtitle="Hyper-personalisation tests. Declaring a winner requires an approval step before promotion."
        back="/notifications"
        backLabel="Notifications"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🧪" iconBg="#e0f2fe" label="Experiments" value={data.length.toLocaleString("en-IN")} />
        <StatCard icon="🛂" iconBg="#fef3c7" label="Awaiting approval" value={awaiting.toLocaleString("en-IN")} />
      </StatGrid>
      <Card title="Experiments">
        <DataTable<Row>
          columns={[
            { key: "name", label: "Name" },
            { key: "status", label: "Status", cellType: "status" },
            { key: "winner", label: "Winner variant" },
          ]}
          rows={rows}
          sortable
          exportable
          exportFilename="notification-experiments"
          emptyIcon="🧪"
          emptyTitle="No experiments"
          emptyMessage="Create an A/B or multivariate experiment to start hyper-personalisation."
        />
      </Card>
      <p className="text-sm muted">
        Status legend: {statusLabel("pending_approval")} means conclude was requested and the winner is waiting on approve-winner.
      </p>
    </>
  );
}
