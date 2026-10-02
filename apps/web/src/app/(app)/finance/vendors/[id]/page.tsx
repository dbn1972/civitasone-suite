import { PageHeader, StatGrid, StatCard, StatusPill, Card, DataTable, EmptyState, LoadErrorState, Masked } from "@/app/_components/ds";
import { getFinanceVendorById } from "@/app/_data/loaders";
import { formatMoney } from "@/lib/formatters";
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

function amountMinorOf(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function rawArray(data: Record<string, unknown>, ...keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const v = data[key];
    if (Array.isArray(v)) return v.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object");
  }
  return [];
}

type BillRow = { billNo: string; date: string; amount: string; tds: string; status: string; [k: string]: unknown };

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

  // Bill history isn't guaranteed on the vendor payload — read it defensively and
  // derive the summary stats from the same raw rows so they never drift from the table.
  const rawBills = rawArray(vendor, "bills", "billHistory");
  const bills: BillRow[] = rawBills.map((b) => {
    const amt = amountMinorOf(b, "amountMinor", "amount");
    const tds = amountMinorOf(b, "tdsMinor", "tds");
    return {
      billNo: field(b, "billNo", "billNumber", "referenceId"),
      date: field(b, "date", "billDate"),
      amount: amt !== undefined ? formatMoney(amt) : "—",
      tds: tds !== undefined ? formatMoney(tds) : "—",
      status: field(b, "status"),
    };
  });
  const totalPaidMinor = rawBills.reduce<number | undefined>((sum, b) => {
    const m = amountMinorOf(b, "amountMinor", "amount");
    return m === undefined ? sum : (sum ?? 0) + m;
  }, undefined);
  const totalTdsMinor = rawBills.reduce<number | undefined>((sum, b) => {
    const m = amountMinorOf(b, "tdsMinor", "tds");
    return m === undefined ? sum : (sum ?? 0) + m;
  }, undefined);

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
        <StatCard icon="₹" iconBg="#ecfdf3" label="Total Paid" value={totalPaidMinor !== undefined ? formatMoney(totalPaidMinor) : "—"} />
        <StatCard icon="🧮" iconBg="#fffaeb" label="TDS Deducted" value={totalTdsMinor !== undefined ? formatMoney(totalTdsMinor) : "—"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Status" value={status} />
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
          <div className="field"><span className="label">Bank</span><span>{field(vendor, "bankName", "bank")} ({field(vendor, "ifsc", "ifscCode")})</span></div>
          <div className="field"><span className="label">Account</span><Masked kind="account" value={rawStr(vendor, "bankAccount", "accountNumber", "accountNo")} fallback="—" ariaLabel="Account number (masked)" /></div>
          <div className="field"><span className="label">Registered Since</span><span>{field(vendor, "registeredSince", "createdAt")}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={status} /></div>
        </div>
      </Card>

      <Card title="Bill History">
        <DataTable<BillRow>
          columns={[
            { key: "billNo", label: "Bill No" },
            { key: "date", label: "Date" },
            { key: "amount", label: "Amount", align: "right" },
            { key: "tds", label: "TDS", align: "right" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={bills}
          emptyIcon="📋"
          emptyTitle="No bills yet"
          emptyMessage="No bills have been recorded for this vendor."
        />
      </Card>
    </div>
  );
}
