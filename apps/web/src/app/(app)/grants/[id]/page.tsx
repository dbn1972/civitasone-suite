import type { ReactNode } from "react";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card, DataTable, StatusPill } from "@/app/_components/ds";
import { getGrantById } from "../../../_data/loaders";
import type { GrantDetail } from "@civitasone/types";

type Installment = GrantDetail["installments"][number];
type UC = GrantDetail["ucs"][number];

type InstallmentCol = {
  key: keyof Installment & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: Installment) => ReactNode;
};

type UCCol = {
  key: keyof UC & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: UC) => ReactNode;
};

const installmentColumns: InstallmentCol[] = [
  { key: "installmentNo", label: "Installment #" },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    render: (row) => `₹${(row.amount / 100).toLocaleString("en-IN")}`,
  },
  { key: "scheduledDate", label: "Scheduled Date" },
  { key: "releasedDate", label: "Released Date", render: (row) => row.releasedDate ?? "—" },
  {
    key: "status",
    label: "Status",
    render: (row) => <StatusPill status={row.status} />,
  },
];

const ucColumns: UCCol[] = [
  { key: "ucNo", label: "UC No" },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    render: (row) => `₹${(row.amount / 100).toLocaleString("en-IN")}`,
  },
  { key: "period", label: "Period" },
  {
    key: "status",
    label: "Status",
    render: (row) => <StatusPill status={row.status} />,
  },
];

export default async function GrantDetailPage({ params }: { params: { id: string } }) {
  const { data: grant, source } = await getGrantById(params.id);

  if (!grant) {
    return (
      <>
        <PageHeader title="Grant Not Found" back="/grants/list" />
        <p className="text-slate-500">Grant not found.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back="/grants/list"
        title={grant.title}
        subtitle={grant.grantNo}
      />
      {source === "error" && <DataSourceBadge source="error" />}

      <Card title="Grant Details" padding>
        <div className="fields">
          <div>
            <span className="lab">Grantee</span>
            <span>{grant.granteeName ?? "—"}</span>
          </div>
          <div>
            <span className="lab">Grantor</span>
            <span>{grant.grantor ?? "—"}</span>
          </div>
          <div>
            <span className="lab">Purpose</span>
            <span>{grant.purpose ?? "—"}</span>
          </div>
          <div>
            <span className="lab">Sanction Date</span>
            <span>{grant.sanctionDate}</span>
          </div>
          <div>
            <span className="lab">Status</span>
            <StatusPill status={grant.status} />
          </div>
          <div>
            <span className="lab">Total Amount</span>
            <span>₹{(grant.totalAmount / 100).toLocaleString("en-IN")}</span>
          </div>
          <div>
            <span className="lab">Disbursed</span>
            <span>₹{(grant.disbursedAmount / 100).toLocaleString("en-IN")}</span>
          </div>
          <div>
            <span className="lab">Pending</span>
            <span>₹{(grant.pendingAmount / 100).toLocaleString("en-IN")}</span>
          </div>
        </div>
      </Card>

      <Card title="Installments">
        <DataTable<Installment>
          columns={installmentColumns}
          rows={grant.installments}
        />
      </Card>

      <Card title="Utilization Certificates">
        <DataTable<UC>
          columns={ucColumns}
          rows={grant.ucs}
        />
      </Card>
    </>
  );
}
