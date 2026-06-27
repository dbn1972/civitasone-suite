import { PageHeader, StatGrid, StatCard, StatusPill, Card, DataTable } from "@/app/_components/ds";

export default function LicenseDetailPage({ params }: { params: { id: string } }) {
  const license = {
    licenseType: "Trade License",
    licenseNo: "TL/2024/00456",
    holder: "M/s Gupta & Sons",
    address: "23, Hazratganj, Lucknow 226001",
    validFrom: "01-Apr-2024",
    validTo: "31-Mar-2025",
    fee: "₹25,000",
    status: "active",
    issuedBy: "Municipal Commissioner Office",
    conditions: "Business hours: 9 AM to 9 PM. No hazardous materials storage. Fire safety compliance mandatory. Annual inspection clearance required.",
  };

  type Renewal = { year: string; date: string; fee: string; status: string; [k: string]: unknown };
  const renewals: Renewal[] = [
    { year: "2024-25", date: "28-Mar-2024", fee: "₹25,000", status: "approved" },
    { year: "2023-24", date: "25-Mar-2023", fee: "₹22,000", status: "approved" },
    { year: "2022-23", date: "30-Mar-2022", fee: "₹20,000", status: "approved" },
    { year: "2021-22", date: "28-Mar-2021", fee: "₹18,000", status: "approved" },
  ];

  type Payment = { receiptNo: string; date: string; amount: string; mode: string; [k: string]: unknown };
  const payments: Payment[] = [
    { receiptNo: "FEE/2024/0234", date: "28-Mar-2024", amount: "₹25,000", mode: "NEFT" },
    { receiptNo: "FEE/2023/0189", date: "25-Mar-2023", amount: "₹22,000", mode: "Cheque" },
    { receiptNo: "FEE/2022/0156", date: "30-Mar-2022", amount: "₹20,000", mode: "NEFT" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={`${license.licenseType} — ${license.licenseNo}`} subtitle={license.holder} back="/finance/licenses" />
      <StatGrid>
        <StatCard icon="📜" iconBg="#e7edfd" label="License Type" value={license.licenseType} />
        <StatCard icon="📅" iconBg="#ecfdf3" label="Valid To" value={license.validTo} />
        <StatCard icon="₹" iconBg="#fffaeb" label="Annual Fee" value={license.fee} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Status" value="Active" />
      </StatGrid>

      <Card title="License Details" padding>
        <div className="fields">
          <div className="field"><span className="label">License No</span><span className="mono">{license.licenseNo}</span></div>
          <div className="field"><span className="label">Holder</span><span>{license.holder}</span></div>
          <div className="field"><span className="label">Address</span><span>{license.address}</span></div>
          <div className="field"><span className="label">Valid From</span><span>{license.validFrom}</span></div>
          <div className="field"><span className="label">Valid To</span><span>{license.validTo}</span></div>
          <div className="field"><span className="label">Issued By</span><span>{license.issuedBy}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={license.status} /></div>
        </div>
      </Card>

      <Card title="Conditions" padding>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{license.conditions}</p>
      </Card>

      <Card title="Renewal History">
        <DataTable<Renewal>
          columns={[
            { key: "year", label: "Year" },
            { key: "date", label: "Renewal Date" },
            { key: "fee", label: "Fee", align: "right" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={renewals}
        />
      </Card>

      <Card title="Payment History">
        <DataTable<Payment>
          columns={[
            { key: "receiptNo", label: "Receipt No" },
            { key: "date", label: "Date" },
            { key: "amount", label: "Amount", align: "right" },
            { key: "mode", label: "Mode" },
          ]}
          rows={payments}
        />
      </Card>
    </main>
  );
}
