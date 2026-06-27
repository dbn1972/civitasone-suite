import { PageHeader, StatGrid, StatCard, StatusPill, Card } from "@/app/_components/ds";

export default function ChequeDetailPage({ params }: { params: { id: string } }) {
  const cheque = {
    chequeNo: "123456",
    date: "15-Jan-2025",
    payee: "M/s Tata Projects Ltd",
    amount: "₹12,50,000",
    bank: "SBI",
    branch: "Parliament Street, New Delhi",
    accountNo: "XXXX-XXXX-7890",
    status: "cleared",
    issuedBy: "Sh. Rajesh Kumar, DDO",
    clearedDate: "17-Jan-2025",
    purpose: "Payment against Bill No. BILL/2025/0456 for infrastructure works",
  };

  const timeline = [
    { date: "15-Jan-2025", event: "Cheque issued", actor: "DDO Office" },
    { date: "15-Jan-2025", event: "Dispatched to payee", actor: "Dispatch Section" },
    { date: "16-Jan-2025", event: "Presented at bank", actor: "Payee" },
    { date: "17-Jan-2025", event: "Cleared by bank", actor: "SBI Parliament St." },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={`Cheque #${cheque.chequeNo}`} subtitle={cheque.payee} back="/finance/treasury/cheques" />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Amount" value={cheque.amount} />
        <StatCard icon="🏦" iconBg="#e7edfd" label="Bank" value={cheque.bank} />
        <StatCard icon="📅" iconBg="#fffaeb" label="Issue Date" value={cheque.date} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Status" value="Cleared" />
      </StatGrid>

      <Card title="Cheque Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Cheque No</span><span className="mono">{cheque.chequeNo}</span></div>
          <div className="field"><span className="label">Payee</span><span>{cheque.payee}</span></div>
          <div className="field"><span className="label">Amount</span><span>{cheque.amount}</span></div>
          <div className="field"><span className="label">Bank & Branch</span><span>{cheque.bank} — {cheque.branch}</span></div>
          <div className="field"><span className="label">Account No</span><span className="mono">{cheque.accountNo}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={cheque.status} /></div>
          <div className="field"><span className="label">Issued By</span><span>{cheque.issuedBy}</span></div>
          <div className="field"><span className="label">Cleared Date</span><span>{cheque.clearedDate}</span></div>
          <div className="field"><span className="label">Purpose</span><span>{cheque.purpose}</span></div>
        </div>
      </Card>

      <Card title="Clearance Timeline" padding>
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Cheque clearance timeline">
          {timeline.map((item, i) => (
            <li key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: i < timeline.length - 1 ? "1px solid var(--border)" : "none" }}>
              <span style={{ minWidth: 100, fontSize: 13, color: "var(--muted)" }}>{item.date}</span>
              <span style={{ flex: 1 }}>{item.event}</span>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>{item.actor}</span>
            </li>
          ))}
        </ol>
      </Card>
    </main>
  );
}
