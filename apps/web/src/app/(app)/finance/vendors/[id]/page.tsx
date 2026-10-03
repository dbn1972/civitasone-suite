import { PageHeader, StatGrid, StatCard, StatusPill, Card, DataTable, EmptyState, LoadErrorState, Masked } from "@/app/_components/ds";
import { getFinanceVendorById } from "@/app/_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { bankLine, billTotals, minorOf } from "./vendorBills";
import { VendorStatusAction } from "../VendorStatusAction";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite, VENDOR_WRITE_ROLES } from "@/lib/finance/writeRoles";

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

/** Best-effort minor-unit amount from a loosely-typed record (number | numeric string | bigint). */
function rawStr(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  const v = field(data, ...keys);
  return v === "—" ? undefined : v;
}

function rawArray(data: Record<string, unknown>, ...keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const v = data[key];
    if (Array.isArray(v)) return v.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object");
  }
  return [];
}

// amount / tds stay raw paise strings (undefined when absent) so the DataTable formats and sorts them numerically.
type BillRow = { id?: string; billNo: string; date: string; amount?: string; tds?: string; status: string; [k: string]: unknown };

export default async function VendorDetailPage({ params }: { params: { id: string } }) {
  const result = await getFinanceVendorById(params.id);
  const { data: vendor } = result;

  if (!vendor) {
    // A failed load (5xx / 403 / network / schema) is NOT "not found": only a
    // real 404 (or a clean empty api response) says the vendor does not exist
    // (GAP-FINANCE-VENDORS-DETAIL-02).
    if (result.source === "error" && result.status !== 404) {
      return (
        <div className="page-main wrap" aria-labelledby="page-heading">
          <PageHeader title="Vendor Detail" back="/finance/vendors" />
          <LoadErrorState result={result} area="vendor" backHref="/finance/vendors" />
        </div>
      );
    }
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Vendor Detail" back="/finance/vendors" />
        <EmptyState icon="🏢" title="Vendor not found" message="This vendor may have been removed or the ID is invalid." />
      </div>
    );
  }

  const name = field(vendor, "name", "vendorName");
  const category = field(vendor, "category", "vendorCategory", "type");
  const status = field(vendor, "status");
  // "Registered Since" is only that when the API supplies it; otherwise the
  // record's creation date is shown under its own honest label.
  const registeredRaw = rawStr(vendor, "registeredSince");
  const registeredLabel = registeredRaw ? "Registered Since" : "Created";
  const registeredSince = formatIndianDate(registeredRaw ?? rawStr(vendor, "createdAt"));

  // Bill history isn't guaranteed on the vendor payload — read it defensively and
  // derive the summary stats from the same raw rows so they never drift from the table.
  const rawBills = rawArray(vendor, "bills", "billHistory");
  const bills: BillRow[] = rawBills.map((b) => {
    const amt = minorOf(b, "amountMinor", "amount");
    const tds = minorOf(b, "tdsMinor", "tds");
    const billId = field(b, "id");
    return {
      ...(billId !== "—" ? { id: billId } : {}),
      billNo: field(b, "billNo", "billNumber", "referenceId"),
      date: field(b, "date", "billDate"),
      ...(amt !== undefined ? { amount: amt.toString() } : {}),
      ...(tds !== undefined ? { tds: tds.toString() } : {}),
      status: field(b, "status"),
    };
  });
  // GAP-FINANCE-VENDORS-DETAIL-03: "Total Paid (initiated)" / TDS count bills with status paid only (payment initiated);
  // pending / rejected bills show up under "Total Billed".
  const totals = billTotals(rawBills);
  const money = (m: bigint | undefined) => (m !== undefined ? formatMoney(m) : "—");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={name}
        subtitle={category !== "—" ? category : undefined}
        back="/finance/vendors"
        actions={
          typeof (vendor as Record<string, unknown>).version === "number" && canWrite(getSessionRoles(), VENDOR_WRITE_ROLES) ? (
            <VendorStatusAction
              id={params.id}
              version={(vendor as Record<string, unknown>).version as number}
              isActive={status.toLowerCase() === "active"}
              name={name}
            />
          ) : null
        }
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total Bills" value={rawBills.length} />
        <StatCard icon="🧾" iconBg="#eff6ff" label="Total Billed" value={money(totals.billedMinor)} />
        <StatCard icon="₹" iconBg="#ecfdf3" label="Total Paid (initiated)" value={money(totals.paidMinor)} />
        <StatCard icon="🧮" iconBg="#fffaeb" label="TDS Deducted (initiated payments)" value={money(totals.tdsOnPaidMinor)} />
      </StatGrid>

      <Card title="Vendor Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Name</span><span>{name}</span></div>
          <div className="field"><span className="label">PAN</span><Masked kind="pan" value={rawStr(vendor, "pan", "panNumber")} fallback="—" ariaLabel="PAN (masked)" /></div>
          <div className="field"><span className="label">GSTIN</span><span className="mono">{field(vendor, "gstin", "gstNumber")}</span></div>
          <div className="field"><span className="label">Category</span><span>{category}</span></div>
          <div className="field"><span className="label">Address</span><span>{field(vendor, "address", "registeredAddress")}</span></div>
          <div className="field"><span className="label">Contact Person</span><span>{field(vendor, "contactPerson", "contactName")}</span></div>
          <div className="field"><span className="label">Email</span><span>{field(vendor, "email", "contactEmail")}</span></div>
          <div className="field"><span className="label">Phone</span><span>{field(vendor, "phone", "contactPhone", "mobile")}</span></div>
          <div className="field"><span className="label">Bank</span><span>{bankLine(field(vendor, "bankName", "bank"), field(vendor, "ifsc", "ifscCode"))}</span></div>
          <div className="field"><span className="label">Account</span><Masked kind="account" value={rawStr(vendor, "bankAccount", "accountNumber", "accountNo")} fallback="—" ariaLabel="Account number (masked)" /></div>
          <div className="field"><span className="label">{registeredLabel}</span><span>{registeredSince}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={status} /></div>
        </div>
      </Card>

      <Card title="Bill History">
        <DataTable<BillRow>
          columns={[
            { key: "billNo", label: "Bill No" },
            { key: "date", label: "Date", cellType: "date" },
            { key: "amount", label: "Amount", align: "right", cellType: "amount" },
            { key: "tds", label: "TDS", align: "right", cellType: "amount" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={bills}
          // Each bill id is the finance bill id the expenditure bill detail route takes.
          rowLinkKey="id"
          rowLinkPrefix="/finance/expenditure/bills/"
          sortable
          pageSize={15}
          emptyIcon="📋"
          emptyTitle="No bills yet"
          emptyMessage="No bills have been recorded for this vendor."
        />
      </Card>
    </div>
  );
}
