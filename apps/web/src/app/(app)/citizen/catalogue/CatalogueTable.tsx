"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable } from "../../../_components/ds";
import { humanizeStatus } from "@/lib/formatters";
import type { CatalogueService } from "../../../_data/citizenPartials";

const CHANNEL_LABELS: Record<string, string> = {
  portal: "Portal", whatsapp: "WhatsApp", counter: "Counter", mobile: "Mobile App",
  ivr: "IVR", csc: "CSC", email: "Email", sms: "SMS",
};
function channelLabel(code: string): string {
  return CHANNEL_LABELS[code.trim().toLowerCase()] ?? humanizeStatus(code);
}

type Row = {
  id: string;
  serviceKey: string;
  name: string;
  ownerDepartment: string;
  version: string;
  channels: string;
  documents: string;
  sla: string;
} & Record<string, unknown>;

/**
 * GAP-CITIZEN-CATALOGUE-03: a filterable/sortable catalogue with a direct
 * Apply action, replacing the static register table. Each row links to the
 * service page and offers a one-click Apply to /citizen/services/{key}/apply.
 */
export function CatalogueTable({ services }: { services: CatalogueService[] }) {
  const t = useTranslations("citizenCatalogue");

  const rows = useMemo<Row[]>(
    () =>
      services.map((s) => ({
        id: s.id,
        serviceKey: s.serviceKey,
        name: s.name,
        ownerDepartment: s.ownerDepartment || "—",
        version: `v${s.version}`,
        channels: s.channels.length ? s.channels.map(channelLabel).join(", ") : "—",
        documents: t("documentsCount", { count: s.requiredDocumentCount }),
        sla: s.slaDays != null ? t("slaDays", { days: s.slaDays }) : "—",
      })),
    [services, t],
  );

  return (
    <DataTable<Row>
      rows={rows}
      sortable
      filterable
      filterPlaceholder={t("filterPlaceholder")}
      pageSize={15}
      columns={[
        {
          key: "name",
          label: t("colService"),
          render: (r) => (
            <Link href={`/citizen/services/${encodeURIComponent(r.serviceKey)}`} style={{ fontWeight: 600 }}>
              {r.name}
            </Link>
          ),
        },
        { key: "ownerDepartment", label: t("colOwner") },
        { key: "version", label: t("colVersion") },
        { key: "channels", label: t("colChannels") },
        { key: "documents", label: t("colDocuments") },
        { key: "sla", label: t("colSla") },
        {
          key: "serviceKey",
          label: t("colApply"),
          sortable: false,
          csvExclude: true,
          render: (r) => (
            <Link href={`/citizen/services/${encodeURIComponent(r.serviceKey)}/apply`} className="btn primary" style={{ minHeight: 36 }}>
              {t("apply")}
            </Link>
          ),
        },
      ]}
    />
  );
}
