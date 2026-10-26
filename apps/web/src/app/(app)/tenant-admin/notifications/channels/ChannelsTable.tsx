"use client";

import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../../_components/ds";
import { ChannelRowActions } from "./ChannelRowActions";

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
export function ChannelsTable({ channels, canManage = false }: { channels: Channel[]; canManage?: boolean }) {
  const t = useTranslations("tenantAdminW2.channels");
  return (
    <DataTable<Channel>
      columns={[
        { key: "name", label: "Channel name" },
        // GAP-CHANNELS-02: no developer hint in the header; values via a label map.
        { key: "type", label: "Channel type", render: (c) => TYPE_LABELS[c.type] ?? c.type },
        { key: "isDefault", label: "Default", render: (c) => (c.isDefault ? "Default" : "—") },
        // GAP-CHANNELS-05: delivery health is the boolean `enabled`, not a status enum.
        { key: "enabled", label: "Status", render: (c) => <StatusPill status={c.enabled ? "active" : "disabled"} label={c.enabled ? "Enabled" : "Disabled"} variant={c.enabled ? "good" : "mut"} /> },
        ...(canManage
          ? [{
              key: "id",
              label: t("actionsHeader"),
              sortable: false,
              render: (c: Channel) => <ChannelRowActions id={c.id} name={c.name} type={c.type} enabled={c.enabled} isDefault={c.isDefault} />,
            }]
          : []),
      ]}
      rows={channels}
      sortable
    />
  );
}
