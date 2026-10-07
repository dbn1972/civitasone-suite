import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, RefreshErrorState, StatCard, StatGrid } from "../../../_components/ds";
import { getNotificationExperiments } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { ExperimentsTable, type ExperimentRow } from "./ExperimentsTable";
import { experimentWinnerDisplay, needsApproval, rankExperiments, statusLabel } from "./experiments";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const { data, source } = await getNotificationExperiments();
  const errored = source === "error";
  const ranked = rankExperiments(data);
  const awaiting = data.filter((e) => needsApproval(e.status)).length;

  const rows: ExperimentRow[] = ranked.map((e) => ({
    id: e.id,
    name: e.name,
    status: e.status,
    winner: experimentWinnerDisplay(e),
    actions: "",
  }));

  return (
    <>
      <PageHeader
        title="A/B & MVT Experiments"
        subtitle="Hyper-personalisation tests. Declaring a winner requires an approval step before promotion."
        back="/notifications"
        backLabel="Notifications"
      />
      {errored && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard
          icon="🧪"
          iconBg="#e0f2fe"
          label="Experiments"
          value={errored ? "—" : data.length.toLocaleString("en-IN")}
        />
        <StatCard
          icon="🛂"
          iconBg="#fef3c7"
          label="Awaiting approval"
          value={errored ? "—" : awaiting.toLocaleString("en-IN")}
        />
      </StatGrid>
      <Card title="Experiments">
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "experiments" })} />
        ) : (
          <ExperimentsTable rows={rows} />
        )}
      </Card>
      <p className="text-sm muted">
        Status legend: {statusLabel("pending_approval")} means conclude was requested and the winner is waiting on approve-winner.
      </p>
    </>
  );
}
