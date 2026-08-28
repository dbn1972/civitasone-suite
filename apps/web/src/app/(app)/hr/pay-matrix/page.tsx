import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getPayMatrix } from "../../../_data/loaders";

type Row = {
  id: string;
  level: string | number;
  payGrade: string;
  cell: string | number;
  basic: string;
} & Record<string, unknown>;

export default async function PayMatrixPage() {
  const { data: levels, source } = await getPayMatrix();

  const rows: Row[] = levels.flatMap((l) =>
    l.cells.map((c) => ({
      id: `${l.level}-${c.cell}`,
      level: l.level,
      payGrade: l.payGrade,
      cell: c.cell,
      basic: c.basicDisplay,
    })),
  );

  const levelCount = levels.length;
  const cellCount = rows.length;
  const minPay = rows.at(0)?.basic ?? "—";
  const maxPay = rows.at(-1)?.basic ?? "—";

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right" }[] = [
    { key: "level", label: "Level", align: "right" },
    { key: "payGrade", label: "Pay Grade" },
    { key: "cell", label: "Cell", align: "right" },
    { key: "basic", label: "Basic Pay", align: "right" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="7th CPC Pay Matrix"
        subtitle="Government pay levels, cells and basic pay amounts per the 7th Central Pay Commission (eHRMS reference)."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label="Pay Levels" value={levelCount} />
        <StatCard icon="🗂️" iconBg="#f5f5f5" label="Total Cells" value={cellCount} />
        <StatCard icon="💰" iconBg="#fffbe6" label="Min Basic Pay" value={minPay} />
        <StatCard icon="💎" iconBg="#e6f7f0" label="Max Basic Pay" value={maxPay} />
      </StatGrid>
      <Card title="Pay Matrix — All Levels">
        <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by level, pay grade or basic pay…"
          pageSize={20}
          emptyIcon="📊"
          emptyTitle="Pay matrix not loaded"
          emptyMessage="The 7th CPC pay matrix data appears here. Use the filter to look up basic pay by level or grade."
        />
      </Card>
    </main>
  );
}
