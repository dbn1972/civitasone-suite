import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type ApiHoliday = {
  id: string;
  date: string;
  day?: string;
  name: string;
  type: string;
  applicableTo?: string;
  status?: string;
};

type Row = {
  id: string;
  date: string;
  day: string;
  name: string;
  type: string;
  applicableTo: string;
  status: string;
} & Record<string, unknown>;

function getDayName(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", { weekday: "long" });
  } catch {
    return "—";
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function mapHolidays(apiHolidays: ApiHoliday[]): Row[] {
  return apiHolidays.map((h) => ({
    id: h.id,
    date: formatDate(h.date),
    day: h.day ?? getDayName(h.date),
    name: h.name,
    type: h.type ?? "Gazetted",
    applicableTo: h.applicableTo ?? "All",
    status: h.status ?? "active",
  }));
}

async function getHolidays(): Promise<Row[]> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/holidays", [], {
    telemetryKey: "hr.holidays",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiHoliday[] })?.data;
      return Array.isArray(arr) ? mapHolidays(arr as ApiHoliday[]) : null;
    },
  });
  return res.data;
}

export default async function HolidaysPage() {
  const items = await getHolidays();

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
