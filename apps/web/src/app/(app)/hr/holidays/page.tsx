import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  date: string;
  day: string;
  name: string;
  type: string;
  applicableTo: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", date: "26/01/2024", day: "Friday", name: "Republic Day", type: "Gazetted", applicableTo: "All", status: "active" },
  { id: "2", date: "29/03/2024", day: "Friday", name: "Good Friday", type: "Gazetted", applicableTo: "All", status: "active" },
  { id: "3", date: "11/04/2024", day: "Thursday", name: "Idul Fitr", type: "Gazetted", applicableTo: "All", status: "active" },
  { id: "4", date: "17/04/2024", day: "Wednesday", name: "Ram Navami", type: "Gazetted", applicableTo: "All", status: "active" },
  { id: "5", date: "15/08/2024", day: "Thursday", name: "Independence Day", type: "Gazetted", applicableTo: "All", status: "active" },
  { id: "6", date: "02/10/2024", day: "Wednesday", name: "Mahatma Gandhi Jayanti", type: "Gazetted", applicableTo: "All", status: "active" },
  { id: "7", date: "01/11/2024", day: "Friday", name: "Diwali", type: "Gazetted", applicableTo: "All", status: "active" },
  { id: "8", date: "25/12/2024", day: "Wednesday", name: "Christmas", type: "Gazetted", applicableTo: "All", status: "active" },
];

export default function HolidaysPage() {
  const gazetted = items.filter((i) => i.type === "Gazetted").length;
  const restricted = items.filter((i) => i.type === "Restricted").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "date", label: "Date" },
    { key: "day", label: "Day" },
    { key: "name", label: "Holiday" },
    { key: "type", label: "Type" },
    { key: "applicableTo", label: "Applicable To" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Holiday Calendar" subtitle="Gazetted, restricted, and optional holidays for the year." back="/hr" />
      <StatGrid>
        <StatCard icon="📅" iconBg="#e6f0ff" label="Total Holidays" value={items.length} />
        <StatCard icon="🏛️" iconBg="#e6f7f0" label="Gazetted" value={gazetted} />
        <StatCard icon="📋" iconBg="#fffbe6" label="Restricted" value={restricted} />
        <StatCard icon="🗓️" iconBg="#f5f5f5" label="Year" value="2024" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Holiday List 2024</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by holiday name or type…" pageSize={15} />
      </div>
    </main>
  );
}
