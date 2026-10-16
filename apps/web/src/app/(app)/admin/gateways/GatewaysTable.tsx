"use client";
import { DataTable, StatCard } from "@/app/_components/ds";
import { SeededAdminList } from "../_components/SeededAdminList";
import { formatMessagesPerDay, formatSuccessRate, summarizeGateways, toGatewayRow, type GatewayRow } from "./gatewayModel";

type RawRow = Record<string, unknown>;

export function GatewaysTable({ gateways, source = "api", unavailable = false }: { gateways: RawRow[]; source?: "api" | "error"; unavailable?: boolean }) {
  return (
    <SeededAdminList<RawRow>
      cacheKey="sa.gateways"
      initialRows={gateways}
      source={source}
      unavailable={unavailable}
      area="gateways"
      cardTitle="Gateway Status"
      stats={(raw) => {
        const s = raw ? summarizeGateways(raw.map(toGatewayRow)) : null;
        return (
          <>
            <StatCard icon="📡" tone="neutral" label="Total Gateways" value={s?.total ?? null} />
            <StatCard icon="✅" tone="good" label="Active" value={s?.active ?? null} />
            <StatCard icon="⚠️" tone="warn" label="Degraded" value={s?.degraded ?? null} />
            <StatCard icon="📨" tone="neutral" label="Standby" value={s?.standby ?? null} />
            <StatCard icon="⛔" tone="bad" label="Down / failed" value={s?.down ?? null} />
            <StatCard icon="❔" tone="neutral" label="Other status" value={s?.other ?? null} />
          </>
        );
      }}
    >
      {(raw) => (
        <DataTable<GatewayRow>
          columns={[
            { key: "type", label: "Type" },
            { key: "provider", label: "Provider" },
            { key: "messagesPerDay", label: "Messages/Day", align: "right", render: (r) => formatMessagesPerDay(r.messagesPerDay) },
            { key: "successRate", label: "Success Rate", align: "right", render: (r) => formatSuccessRate(r.successRate) },
            { key: "lastChecked", label: "Last Checked" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={raw.map(toGatewayRow)}
          sortable filterable filterPlaceholder="Search gateways…" pageSize={15} exportable exportAudit="admin/gateways" exportFilename="gateways"
          emptyIcon="📡" emptyTitle="No gateways" emptyMessage="No communication gateways configured."
        />
      )}
    </SeededAdminList>
  );
}
