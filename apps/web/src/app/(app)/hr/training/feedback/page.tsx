import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  program: string;
  rating: string;
  contentRating: string;
  trainerRating: string;
  comments: string;
  submittedOn: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", program: "Advanced Excel for Finance", rating: "4.5/5", contentRating: "5/5", trainerRating: "4/5", comments: "Very practical and well-paced", submittedOn: "15/07/2024" },
  { id: "2", employee: "Priya Sharma", program: "Leadership Development", rating: "4/5", contentRating: "4/5", trainerRating: "4/5", comments: "Good case studies, needs more role-play", submittedOn: "12/07/2024" },
  { id: "3", employee: "Amit Patel", program: "Cybersecurity Essentials", rating: "5/5", contentRating: "5/5", trainerRating: "5/5", comments: "Excellent — very relevant to our work", submittedOn: "10/07/2024" },
  { id: "4", employee: "Sunita Rao", program: "RTI Act Workshop", rating: "3.5/5", contentRating: "4/5", trainerRating: "3/5", comments: "Content good but delivery could improve", submittedOn: "08/07/2024" },
  { id: "5", employee: "Vikram Singh", program: "eOffice Training", rating: "4/5", contentRating: "4/5", trainerRating: "4.5/5", comments: "Hands-on approach was helpful", submittedOn: "05/07/2024" },
  { id: "6", employee: "Meera Iyer", program: "PFMS & Budget Mgmt", rating: "4.5/5", contentRating: "5/5", trainerRating: "4/5", comments: "Very useful for day-to-day work", submittedOn: "03/07/2024" },
];

export default function TrainingFeedbackPage() {
  const avgRating = "4.3/5";
  const totalResponses = items.length;
  const highRated = items.filter((i) => parseFloat(i.rating) >= 4.5).length;

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: "Employee" },
    { key: "program", label: "Program" },
    { key: "rating", label: "Overall Rating" },
    { key: "contentRating", label: "Content" },
    { key: "trainerRating", label: "Trainer" },
    { key: "comments", label: "Comments" },
    { key: "submittedOn", label: "Submitted" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Training Feedback" subtitle="Post-training feedback and program ratings." back="/hr" />
      <StatGrid>
        <StatCard icon="📝" iconBg="#e6f0ff" label="Total Responses" value={totalResponses} />
        <StatCard icon="⭐" iconBg="#fffbe6" label="Avg Rating" value={avgRating} />
        <StatCard icon="🏆" iconBg="#e6f7f0" label="High Rated (4.5+)" value={highRated} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Programs Covered" value={6} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Feedback Responses</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or program…" pageSize={15} />
      </div>
    </main>
  );
}
