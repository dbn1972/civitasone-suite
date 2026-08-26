import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, DataTable } from "../../../../_components/ds";
import { getRFQById } from "../../../../_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

type LineItemRow = Record<string, unknown> & {
  itemName: string;
  quantity: string;
  unit: string;
};

type ResponseRow = Record<string, unknown> & {
  vendorName: string;
  totalAmount: string;
  submittedAt: string;
  status: string;
};

const LINE_ITEM_COLUMNS: { key: keyof LineItemRow; label: string; align?: "left" | "right" }[] = [
  { key: "itemName", label: "Item Name" },
  { key: "quantity", label: "Qty", align: "right" },
  { key: "unit", label: "Unit" },
];

const RESPONSE_COLUMNS: { key: keyof ResponseRow; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
  { key: "vendorName", label: "Vendor" },
  { key: "totalAmount", label: "Bid Amount", align: "right" },
  { key: "submittedAt", label: "Submitted" },
  { key: "status", label: "Status", cellType: "status" },
];

export default async function RFQDetailPage({ params }: { params: { id: string } }) {
  const { data: rfq, source } = await getRFQById(params.id);

  if (!rfq) {
    // L3 fix: see indents/[id]/page.tsx — don't tell the officer an RFQ is
    // "removed or invalid" when the real cause was a fetch error.
    return (
      <>
        <PageHeader title="RFQ Detail" back="/procurement/rfq" />
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "RFQ" })} backHref="/procurement/rfq" />
        ) : (
          <EmptyState icon="📝" title="RFQ not found" message="This RFQ may have been removed or the ID is invalid." />
        )}
      </>
    );
  }

  const lineRows: LineItemRow[] = rfq.lineItems.map((item) => ({
    itemName: item.itemName,
    quantity: String(item.quantity),
    unit: item.unit,
  }));

  const responseRows: ResponseRow[] = rfq.responses.map((resp) => ({
    vendorName: resp.vendorName,
    totalAmount: formatMoney(resp.totalAmount),
    submittedAt: formatIndianDate(resp.submittedAt),
    status: resp.status,
  }));

  return (
    <>
      <PageHeader
        title={rfq.rfqNo}
        subtitle={rfq.title}
        back="/procurement/rfq"
        actions={
          <>
            <StatusPill status={rfq.status} />
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <Card title="RFQ details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">RFQ No</span>
            <span className="mono">{rfq.rfqNo}</span>
          </div>
          <div className="field">
            <span className="label">Indent Ref</span>
            <span className="mono">{rfq.indentRef ?? "—"}</span>
          </div>
          <div className="field">
            <span className="label">Closing Date</span>
            <span>{formatIndianDate(rfq.closingDate)}</span>
          </div>
          <div className="field">
            <span className="label">Vendors Invited</span>
            <span>{rfq.vendorsInvited}</span>
          </div>
          <div className="field">
            <span className="label">Responses</span>
            <span>{rfq.responsesReceived}</span>
          </div>
          {rfq.description && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Description</span>
              <span>{rfq.description}</span>
            </div>
          )}
        </div>
      </Card>

      {rfq.lineItems.length > 0 && (
        <Card title="Line items">
          <DataTable<LineItemRow>
            columns={LINE_ITEM_COLUMNS}
            rows={lineRows}
            pageSize={50}
          />
        </Card>
      )}

      {rfq.responses.length > 0 && (
        <Card title="Vendor responses">
          <DataTable<ResponseRow>
            columns={RESPONSE_COLUMNS}
            rows={responseRows}
            pageSize={25}
          />
        </Card>
      )}
    </>
  );
}
