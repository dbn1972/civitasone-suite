import { Card, DataTable, PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getFieldRoutesDetailed, type FieldRouteRow, FIELD_ROUTES_LIMIT } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldRoutesDetailed();

  if (source === "error") {
    return (
      <>
        <PageHeader title="Routes" subtitle="Daily agent routes with optimised stop order." back="/field" backLabel="Field Operations" />
        <Card title="Routes">
          <RefreshErrorState
            error={{ what: "Could not load field routes", next: "Check your connection and try again.", actions: ["retry", "back"] }}
            source={{ area: "field routes" }}
            backHref="/field"
          />
        </Card>
      </>
    );
  }

  // GAP-FIELD-ROUTES-02: surface the stop count, distance and agent the route
  // optimiser produces, instead of a generic label/sub-label.
  const rows = data.map((r) => ({
    ...r,
    stops: `${r.stopCount}`,
    distance: r.distanceKm ? `${r.distanceKm} km` : "—",
    duration: r.durationMinutes === null ? "—" : `${r.durationMinutes} min`,
  }));
  type RouteDisplay = FieldRouteRow & { stops: string; distance: string; duration: string };

  return (
    <>
      <PageHeader title="Routes" subtitle="Daily agent routes with optimised stop order." back="/field" backLabel="Field Operations" />
      <Card title={data.length >= FIELD_ROUTES_LIMIT ? `Routes (latest ${FIELD_ROUTES_LIMIT})` : "Routes"}>
        <DataTable<RouteDisplay>
          columns={[
            { key: "routeDate", label: "Date", cellType: "date" },
            { key: "agent", label: "Agent" },
            { key: "stops", label: "Stops", align: "right" },
            { key: "distance", label: "Distance", align: "right" },
            { key: "duration", label: "Est. time", align: "right" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter routes…"
          pageSize={20}
          emptyIcon="🧭"
          emptyTitle="No routes yet"
          emptyMessage="Optimised daily routes will appear here."
        />
      </Card>
    </>
  );
}
