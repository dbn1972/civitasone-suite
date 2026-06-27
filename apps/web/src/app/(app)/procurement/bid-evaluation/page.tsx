import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function BidEvaluationPage() {
  type Row = { tender: string; bidder: string; technicalScore: number; financialScore: number; totalScore: number; rank: number; status: string };

  const rows: Row[] = [
    { tender: "NIT/2024/PWD/0142", bidder: "Aravali Constructions Pvt Ltd", technicalScore: 82, financialScore: 91, totalScore: 86.5, rank: 1, status: "Recommended" },
    { tender: "NIT/2024/PWD/0142", bidder: "Bharat Infrastructure Ltd", technicalScore: 78, financialScore: 88, totalScore: 83.0, rank: 2, status: "Qualified" },
    { tender: "NIT/2024/IT/0098", bidder: "DigiGov Solutions", technicalScore: 90, financialScore: 72, totalScore: 81.0, rank: 1, status: "Recommended" },
    { tender: "NIT/2024/IT/0098", bidder: "TechServe India", technicalScore: 85, financialScore: 70, totalScore: 77.5, rank: 2, status: "Qualified" },
    { tender: "NIT/2024/MED/0056", bidder: "MedEquip Healthcare", technicalScore: 74, financialScore: 65, totalScore: 69.5, rank: 3, status: "Disqualified" },
    { tender: "NIT/2024/MED/0056", bidder: "Surgipharma India", technicalScore: 88, financialScore: 80, totalScore: 84.0, rank: 1, status: "Recommended" },
    { tender: "NIT/2024/ELEC/0201", bidder: "PowerGrid Solutions", technicalScore: 92, financialScore: 85, totalScore: 88.5, rank: 1, status: "Recommended" },
    { tender: "NIT/2024/ELEC/0201", bidder: "Electra India Corp", technicalScore: 60, financialScore: 95, totalScore: 77.5, rank: 2, status: "Under Review" },
  ];

  const columns = [
    { key: "tender" as const, label: "Tender Ref" },
    { key: "bidder" as const, label: "Bidder" },
    { key: "technicalScore" as const, label: "Technical Score", align: "right" as const },
    { key: "financialScore" as const, label: "Financial Score", align: "right" as const },
    { key: "totalScore" as const, label: "Total Score", align: "right" as const },
    { key: "rank" as const, label: "Rank", align: "center" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Bid Evaluation" subtitle="Technical and financial scoring matrix for open tenders." back="/procurement" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef2ff" label="Active Evaluations" value={4} />
        <StatCard icon="🏢" iconBg="#ecfdf3" label="Total Bidders" value={8} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Recommended" value={4} />
        <StatCard icon="⏳" iconBg="#fce7ee" label="Under Review" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Evaluation Matrix</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
