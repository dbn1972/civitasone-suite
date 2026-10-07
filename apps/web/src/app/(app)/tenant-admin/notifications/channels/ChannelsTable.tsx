"use client";

import { DataTable, StatusPill } from "../../../../_components/ds";

export type Channel = {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  enabled: boolean;
} & Record<string, unknown>;

const TYPE_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push notification",
  in_app: "In-app",
  whatsapp: "WhatsApp",
};

/**
 * Client Component: DataTable `render` functions cannot cross the Server ->
 * Client boundary, so the page passes only serializable rows and the cell
 * renderers live here (see scripts/ci/datatable-render-guard.mjs).
 */
export function ChannelsTable({ channels }: { channels: Channel[] }) {
  return (
    <DataTable<Channel>
      columns={[
        { key: "name", label: "Channel name" },
        // GAP-CHANNELS-02: no developer hint in the header; values via a label map.
        { key: "type", label: "Channel type", render: (c) => TYPE_LABELS[c.type] ?? c.type },
        { key: "isDefault", label: "Default", render: (c) => (c.isDefault ? "Default" : "—") },
        // GAP-CHANNELS-05: delivery health is the boolean `enabled`, not a status enum.
        { key: "enabled", label: "Status", render: (c) => <StatusPill status={c.enabled ? "active" : "disabled"} label={c.enabled ? "Enabled" : "Disabled"} variant={c.enabled ? "good" : "mut"} /> },
      ]}
      rows={channels}
      sortable
    />
  );
}
