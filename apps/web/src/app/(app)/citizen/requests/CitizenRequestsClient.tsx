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

// GAP-CITIZEN-REQUESTS-05: stable, locale-independent ids for state/filtering;
// labels come from next-intl so switching locale re-labels the control.
// GAP-CITIZEN-REQUESTS-04: the "Breached" segment was removed — nothing in the
// citizen-service request read-model emits a `breached` status (the summary
// status enum is submitted|under_review|in_progress|resolved|rejected), so the
// filter could only ever show an empty list and implied SLA data that this
// register does not carry.
type SegValue = "all" | "grievance" | "service";

export function CitizenRequestsClient({ requests }: Props) {
  const t = useTranslations("citizenRequests");
  const [active, setActive] = useState<SegValue>("all");

  const SEG_OPTIONS = [
    { value: "all", label: t("segAll") },
    { value: "grievance", label: t("segGrievance") },
    { value: "service", label: t("segService") },
  ];

  const COLUMNS = [
    { key: "requestNo" as const, label: t("colRequestNo") },
    { key: "citizenName" as const, label: t("colCitizenName") },
    { key: "serviceType" as const, label: t("colServiceType") },
    { key: "submittedAt" as const, label: t("colSubmitted") },
    // GAP-CITIZEN-REQUESTS-02: the citizen-service read-model already returns
    // this phone masked ("XXXXXX####"); the register renders it as given and
    // never requests or displays the raw number.
    { key: "citizenPhone" as const, label: t("colPhone") },
    { key: "status" as const, label: t("colStatus"), cellType: "status" as const },
  ];

  const filtered =
    active === "grievance"
      ? requests.filter((r) => r.serviceType?.toLowerCase().includes("grievance"))
      : active === "service"
      ? requests.filter((r) => !r.serviceType?.toLowerCase().includes("grievance"))
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
          <Segmented value={active} onChange={(v) => setActive(v as SegValue)} options={SEG_OPTIONS} />
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
