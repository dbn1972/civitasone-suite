"use client";
import { DataTable } from "@/app/_components/ds";
import { SeededAdminList } from "../_components/SeededAdminList";
import type { GatewayRouteRow } from "./routeModel";

export function GatewayRoutesTable({ routes, source = "api" }: { routes: GatewayRouteRow[]; source?: "api" | "error" }) {
  return (
    <SeededAdminList<GatewayRouteRow>
      cacheKey="module.gateway-route-catalogue"
      initialRows={routes}
      source={source}
      area="the route catalogue"
      cardTitle="Routes"
    >
      {(rows) => (
        <DataTable<GatewayRouteRow>
          columns={[
            { key: "method", label: "Method" },
            { key: "path", label: "Path", render: (r) => <span className="mono" title={r.path}>{r.path}</span> },
            { key: "name", label: "Name" },
            { key: "module", label: "Module" },
            { key: "upstream", label: "Upstream", render: (r) => r.upstream || "—" },
            { key: "status", label: "Status", cellType: "status" },
            { key: "updated", label: "Updated" },
          ]}
          rows={rows}
          sortable filterable filterPlaceholder="Search routes…" pageSize={25}
          emptyIcon="🛣️" emptyTitle="No routes registered" emptyMessage="No routes registered in the API catalogue yet."
        />
      )}
    </SeededAdminList>
  );
}
