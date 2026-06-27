import { PageHeader, StatGrid, StatCard, StatusPill, Card } from "@/app/_components/ds";

export default function ChallanDetailPage({ params }: { params: { id: string } }) {
  const challan = {
    challanNo: "CHN/2024/001",
    department: "Revenue Department",
    amount: "₹15,00,000",
    bank: "SBI",
    branch: "Civil Lines, Lucknow",
    date: "15-Jan-2025",
    status: "approved",
    depositor: "Sh. Arun Mishra, Accounts Officer",
    purpose: "Deposit of Stamp Duty collections for Q3 FY2024-25",
    headOfAccount: "0030-Stamps & Registration",
    treasuryCode: "TR-LKO-001",
  };

  const breakdown = [
    { particular: "Stamp Duty — Residential", amount: "₹8,50,000" },
    { particular: "Stamp Duty — Commercial", amount: "₹4,25,000" },
    { particular: "Registration Fees", amount: "₹1,75,000" },
    { particular: "Miscellaneous", amount: "₹50,000" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={`Challan ${challan.challanNo}`} subtitle={challan.department} back="/finance/revenue/challans" />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Amount" value={challan.amount} />
        <StatCard icon="🏦" iconBg="#e7edfd" label="Bank" value={challan.bank} />
        <StatCard icon="📅" iconBg="#fffaeb" label="Date" value={challan.date} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Status" value="Approved" />
      </StatGrid>

      <Card title="Challan Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Challan No</span><span className="mono">{challan.challanNo}</span></div>
          <div className="field"><span className="label">Department</span><span>{challan.department}</span></div>
          <div className="field"><span className="label">Amount</span><span>{challan.amount}</span></div>
          <div className="field"><span className="label">Bank & Branch</span><span>{challan.bank} — {challan.branch}</span></div>
          <div className="field"><span className="label">Head of Account</span><span>{challan.headOfAccount}</span></div>
          <div className="field"><span className="label">Treasury Code</span><span className="mono">{challan.treasuryCode}</span></div>
          <div className="field"><span className="label">Depositor</span><span>{challan.depositor}</span></div>
          <div className="field"><span className="label">Purpose</span><span>{challan.purpose}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={challan.status} /></div>
        </div>
      </Card>

      <Card title="Amount Breakdown" padding>
        <table className="tbl" aria-label="Challan amount breakdown">
          <thead>
            <tr><th>Particular</th><th style={{ textAlign: "right" }}>Amount</th></tr>
          </thead>
          <tbody>
            {breakdown.map((item, i) => (
              <tr key={i}><td>{item.particular}</td><td style={{ textAlign: "right" }}>{item.amount}</td></tr>
            ))}
            <tr style={{ fontWeight: 600 }}><td>Total</td><td style={{ textAlign: "right" }}>{challan.amount}</td></tr>
          </tbody>
        </table>
      </Card>
    </main>
  );
}
