import { PageHeader, StatGrid, StatCard, StatusPill, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getFinanceVendorById } from "@/app/_data/loaders";
import { formatMoney } from "@/lib/formatters";

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

/** Best-effort minor-unit amount from a loosely-typed record (number | numeric string | bigint). */
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
  const { data: vendor, source } = await getFinanceVendorById(params.id);

  if (!vendor) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Vendor Detail" back="/finance/vendors" />
        <EmptyState icon="🏢" title="Vendor not found" message="This vendor may have been removed or the ID is invalid." />
      </main>
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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={name}
        subtitle={category !== "—" ? category : undefined}
        back="/finance/vendors"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
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
          <div className="field"><span className="label">PAN</span><span className="mono">{field(vendor, "pan", "panNumber")}</span></div>
          <div className="field"><span className="label">GSTIN</span><span className="mono">{field(vendor, "gstin", "gstNumber")}</span></div>
          <div className="field"><span className="label">Category</span><span>{category}</span></div>
          <div className="field"><span className="label">Address</span><span>{field(vendor, "address", "registeredAddress")}</span></div>
          <div className="field"><span className="label">Contact Person</span><span>{field(vendor, "contactPerson", "contactName")}</span></div>
          <div className="field"><span className="label">Email</span><span>{field(vendor, "email", "contactEmail")}</span></div>
          <div className="field"><span className="label">Phone</span><span>{field(vendor, "phone", "contactPhone", "mobile")}</span></div>
          <div className="field"><span className="label">Bank</span><span>{field(vendor, "bankName", "bank")} ({field(vendor, "ifsc", "ifscCode")})</span></div>
          <div className="field"><span className="label">Account</span><span className="mono">{field(vendor, "bankAccount", "accountNumber", "accountNo")}</span></div>
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
    </main>
  );
}
