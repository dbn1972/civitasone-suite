import { PageHeader, StatGrid, StatCard, StatusPill, Card, DataTable } from "@/app/_components/ds";

export default function VendorDetailPage({ params }: { params: { id: string } }) {
  const vendor = {
    name: "M/s Tata Projects Ltd",
    pan: "AAACT1234A",
    gstin: "09AAACT1234A1Z5",
    category: "Works Contractor",
    status: "active",
    address: "One Bangalore West, Rajaji Nagar, Bengaluru 560010",
    bankName: "State Bank of India",
    bankAccount: "XXXX-XXXX-7890",
    ifsc: "SBIN0001234",
    contactPerson: "Mr. Sunil Mehta",
    email: "accounts@tataprojects.com",
    phone: "+91-80-2345-6789",
    registeredSince: "15-Mar-2020",
  };

  type Bill = { billNo: string; date: string; amount: string; tds: string; status: string; [k: string]: unknown };
  const bills: Bill[] = [
    { billNo: "BILL/2025/0456", date: "15-Jan-2025", amount: "₹24,50,000", tds: "₹2,45,000", status: "approved" },
    { billNo: "BILL/2024/0892", date: "12-Dec-2024", amount: "₹18,00,000", tds: "₹1,80,000", status: "approved" },
    { billNo: "BILL/2024/0745", date: "28-Oct-2024", amount: "₹35,00,000", tds: "₹3,50,000", status: "approved" },
    { billNo: "BILL/2024/0612", date: "15-Sep-2024", amount: "₹42,00,000", tds: "₹4,20,000", status: "approved" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={vendor.name} subtitle={vendor.category} back="/finance/vendors" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total Bills" value={28} />
        <StatCard icon="₹" iconBg="#ecfdf3" label="Total Paid" value="₹4.2 Cr" />
        <StatCard icon="🧮" iconBg="#fffaeb" label="TDS Deducted" value="₹42 L" />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Status" value="Active" />
      </StatGrid>

      <Card title="Vendor Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Name</span><span>{vendor.name}</span></div>
          <div className="field"><span className="label">PAN</span><span className="mono">{vendor.pan}</span></div>
          <div className="field"><span className="label">GSTIN</span><span className="mono">{vendor.gstin}</span></div>
          <div className="field"><span className="label">Category</span><span>{vendor.category}</span></div>
          <div className="field"><span className="label">Address</span><span>{vendor.address}</span></div>
          <div className="field"><span className="label">Contact Person</span><span>{vendor.contactPerson}</span></div>
          <div className="field"><span className="label">Email</span><span>{vendor.email}</span></div>
          <div className="field"><span className="label">Phone</span><span>{vendor.phone}</span></div>
          <div className="field"><span className="label">Bank</span><span>{vendor.bankName} ({vendor.ifsc})</span></div>
          <div className="field"><span className="label">Account</span><span className="mono">{vendor.bankAccount}</span></div>
          <div className="field"><span className="label">Registered Since</span><span>{vendor.registeredSince}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={vendor.status} /></div>
        </div>
      </Card>

      <Card title="Bill History">
        <DataTable<Bill>
          columns={[
            { key: "billNo", label: "Bill No" },
            { key: "date", label: "Date" },
            { key: "amount", label: "Amount", align: "right" },
            { key: "tds", label: "TDS", align: "right" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={bills}
        />
      </Card>
    </main>
  );
}
