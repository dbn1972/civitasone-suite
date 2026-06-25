"use client";
import { useState } from "react";
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

const COLUMNS = [
  { key: "requestNo" as const, label: "Request No" },
  { key: "citizenName" as const, label: "Citizen Name" },
  { key: "serviceType" as const, label: "Service Type" },
  { key: "submittedAt" as const, label: "Submitted" },
  { key: "citizenPhone" as const, label: "Phone" },
  { key: "status" as const, label: "Status", cellType: "status" as const },
];

export function CitizenRequestsClient({ requests }: Props) {
  const [active, setActive] = useState("All");

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
        <h3>Grievances &amp; service requests</h3>
        <div role="group" aria-label="Filter by request type">
          <Segmented value={active} onChange={setActive} options={SEG_OPTIONS} />
        </div>
      </div>
      {requests.length === 0 ? (
        <EmptyState icon="📨" title="No service requests" message="Citizen requests will appear here once submitted." />
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
