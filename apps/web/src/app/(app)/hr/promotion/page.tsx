import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { PromoteWithApproval } from "./PromoteWithApproval";
import { PromotionCard, type PromotionRow } from "./_components/PromotionCard";

async function getData(): Promise<LoaderResult<PromotionRow[]>> {
  const r = await fetchJson<unknown, PromotionRow[]>("/api/v1/hrms/lifecycle/promotions", [], {
    telemetryKey: "hr.promotion.lifecycle",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PromotionRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  if (r.data.length === 0) {
    return fetchJson<unknown, PromotionRow[]>("/api/v1/hrms/promotions", [], {
      telemetryKey: "hr.promotion",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: PromotionRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    });
  }
  return r;
}

export default async function PromotionPage() {
  const { data: items, source } = await getData();

  const approved  = items.filter((i) => ["approved", "signed", "completed", "finance_approved"].includes(i.status)).length;
  const pending   = items.filter((i) => ["pending"].includes(i.status)).length;
  const inApproval= items.filter((i) => ["dept_approved", "hr_approved"].includes(i.status)).length;
  const completed = items.filter((i) => ["signed", "completed"].includes(i.status)).length;

  const tableColumns: { key: keyof PromotionRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",     label: "Employee"       },
    { key: "department",   label: "Department"     },
    { key: "fromGrade",    label: "From Grade"     },
    { key: "toGrade",      label: "To Grade"       },
    { key: "effectiveDate",label: "Effective Date" },
    { key: "orderNo",      label: "Order No."      },
    { key: "status",       label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Promotions"
        subtitle="Grade progression — DPC seniority list, individual promotions, and approval chain."
        back="/hr"
        actions={<PromoteWithApproval />}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="⬆️" iconBg="#e6f7f0"  label="Total Promotions" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f0ff"  label="Approved / Signed" value={approved} />
        <StatCard icon="🔄" iconBg="#ede9fe"  label="In Approval"       value={inApproval} />
        <StatCard icon="⏳" iconBg="#fffbe6"  label="Initiated"         value={pending} />
        <StatCard icon="📋" iconBg="#f5f5f5"  label="Signed & Issued"   value={completed} />
      </StatGrid>

      {/* Card grid view */}
      {items.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--ink2)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 14px" }}>
            Promotion Orders
          </h2>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))" }}>
            {items.map((p) => (
              <PromotionCard key={p.id} promotion={p} />
            ))}
          </div>
        </div>
      )}

      {/* Table view */}
      <Card title="Promotions — Table View">
        <DataTable<PromotionRow>
          columns={tableColumns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, department or grade…"
          pageSize={15}
          emptyIcon="📈"
          emptyTitle="No promotion orders"
          emptyMessage="Promotion orders appear here once raised and approved. Use '+ Raise Promotion' to initiate a grade progression."
        />
      </Card>
    </main>
  );
}
