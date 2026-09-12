"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, Segmented, EmptyState } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

interface ServiceRequest {
  id: string;
  requestNo: string;
  citizenName: string;
  serviceType: string;
  submittedAt: string;
  citizenPhone?: string | null;
  status: string;
}

interface Props {
  requests: ServiceRequest[];
}

const SEG_OPTIONS = ["All", "Grievance", "Service", "Breached"];

export function CitizenRequestsClient({ requests }: Props) {
  const t = useTranslations("citizenRequests");
  const [active, setActive] = useState("All");

  const COLUMNS = [
    { key: "requestNo" as const, label: t("colRequestNo") },
    { key: "citizenName" as const, label: t("colCitizenName") },
    { key: "serviceType" as const, label: t("colServiceType") },
    { key: "submittedAt" as const, label: t("colSubmitted") },
    { key: "citizenPhone" as const, label: t("colPhone") },
    { key: "status" as const, label: t("colStatus"), cellType: "status" as const },
  ];

  const filtered =
    active === "Grievance"
      ? requests.filter((r) => r.serviceType?.toLowerCase().includes("grievance"))
      : active === "Service"
      ? requests.filter((r) => !r.serviceType?.toLowerCase().includes("grievance"))
      : active === "Breached"
      ? requests.filter((r) => r.status === "breached")
      : requests;

  const rows = filtered.map((r) => ({
    ...r,
    submittedAt: formatIndianDate(r.submittedAt),
    citizenPhone: r.citizenPhone ?? "—",
  }));

  return (
    <div className="card">
      <div className="card-h">
        <h3>{t("tableTitle")}</h3>
        <div role="group" aria-label={t("filterAriaLabel")}>
          <Segmented value={active} onChange={setActive} options={SEG_OPTIONS} />
        </div>
      </div>
      {requests.length === 0 ? (
        <EmptyState icon="📨" title={t("emptyTitle")} message={t("emptyMessage")} />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          sortable
          filterable
          pageSize={15}
          rowLinkKey="id"
          rowLinkPrefix="/citizen/requests/"
        />
      )}
    </div>
  );
}
