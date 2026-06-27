import { PageHeader, StatGrid, StatCard, StatusPill, Card } from "@/app/_components/ds";

export default function AuditParaDetailPage({ params }: { params: { id: string } }) {
  const para = {
    paraNo: "AP/2024/001",
    year: "2023-24",
    amount: "₹4,50,00,000",
    department: "Public Works Department",
    status: "pending",
    subject: "Irregular expenditure on road construction without proper tendering",
    observation: "The department incurred expenditure of ₹4.50 crore on construction of approach roads without following the prescribed tendering process under GFR 2017. The works were split into smaller packages to avoid open competitive bidding.",
    reply: "The department has submitted that the works were of urgent nature due to monsoon damage and were executed under emergency provisions. Detailed reply with supporting documents is being compiled.",
    actionTaken: "Show-cause notice issued to concerned officers. Recovery proceedings initiated for excess payment of ₹45 lakhs.",
  };

  const timeline = [
    { date: "15-Aug-2024", event: "Audit para issued by CAG", actor: "AG Office" },
    { date: "30-Sep-2024", event: "First reply submitted", actor: "PWD" },
    { date: "15-Nov-2024", event: "Reply found inadequate", actor: "PAC" },
    { date: "01-Dec-2024", event: "Revised reply submitted", actor: "PWD" },
    { date: "15-Jan-2025", event: "Under review by PAC", actor: "PAC Secretariat" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={`Audit Para ${para.paraNo}`} subtitle={para.department} back="/finance/audit-paras" />
      <StatGrid>
        <StatCard icon="₹" iconBg="#fce7ee" label="Amount" value={para.amount} />
        <StatCard icon="📅" iconBg="#e7edfd" label="Year" value={para.year} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Department" value="PWD" />
        <StatCard icon="⏳" iconBg="#fce7ee" label="Status" value="Pending" />
      </StatGrid>

      <Card title="Observation" padding>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{para.observation}</p>
      </Card>

      <Card title="Department Reply" padding>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{para.reply}</p>
      </Card>

      <Card title="Action Taken" padding>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{para.actionTaken}</p>
        <div style={{ marginTop: 12 }}>
          <span className="label">Current Status: </span><StatusPill status={para.status} />
        </div>
      </Card>

      <Card title="Timeline" padding>
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Audit para timeline">
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
