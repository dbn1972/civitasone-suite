import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState } from "../../../_components/ds";
import { getCatalogueOfferings } from "../../../_data/loaders";

type Row = {
  id: string;
  name: string;
  category: string;
  approval: string;
  priority: string;
  fulfilment: string;
};

export default async function Page() {
  const { data: offerings, source } = await getCatalogueOfferings();

  const categories = new Set(offerings.map((o) => o.category));
  const needsApproval = offerings.filter((o) => o.approvalRequired).length;

  const rows: Row[] = offerings.map((o) => ({
    id: o.id,
    name: o.name,
    category: o.category,
    approval: o.approvalRequired ? "Maker-checker" : "Auto",
    priority: o.defaultPriority,
    fulfilment: `${o.fulfilmentStages.length} stage${o.fulfilmentStages.length === 1 ? "" : "s"}`,
  }));

  return (
    <>
      <PageHeader
        title="Service Catalogue"
        subtitle="Browse available services and raise a self-service request."
        back="/helpdesk"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🧾" iconBg="#eef2ff" label="Offerings" value={offerings.length.toLocaleString("en-IN")} />
        <StatCard icon="🗂️" iconBg="#ecfeff" label="Categories" value={categories.size.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#f0fdf4" label="Approval Required" value={needsApproval.toLocaleString("en-IN")} />
        <StatCard icon="📥" iconBg="#fffbeb" label="My Requests" value="—" />
      </StatGrid>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <Link href="/helpdesk/catalogue/my-requests" className="btn ghost" style={{ minHeight: 40 }}>My requests</Link>
        <Link href="/helpdesk/catalogue/breaches" className="btn ghost" style={{ minHeight: 40 }}>Breach report</Link>
      </div>
      <div className="card">
        <div className="card-h"><h3>Catalogue offerings</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🧾" title="No offerings yet" message="An administrator can publish catalogue offerings to enable self-service requests." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "name", label: "Offering" },
              { key: "category", label: "Category", cellType: "status" },
              { key: "priority", label: "Priority", cellType: "status" },
              { key: "approval", label: "Approval" },
              { key: "fulfilment", label: "Fulfilment" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/helpdesk/catalogue/"
            sortable
            filterable
            filterPlaceholder="Filter catalogue…"
            pageSize={15}
            exportable
            exportFilename="catalogue-offerings"
          />
        )}
      </div>
    </>
  );
}
