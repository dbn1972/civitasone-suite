import { PageHeader, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getPayMatrix } from "../../../_data/loaders";

export default async function PayMatrixPage() {
  const { data: levels, source } = await getPayMatrix();

  const rows = levels.flatMap((l) =>
    l.cells.map((c) => ({
      id: `${l.level}-${c.cell}`,
      level: l.level,
      payGrade: l.payGrade,
      cell: c.cell,
      basic: c.basicDisplay,
    })),
  );

  return (
    <>
      <PageHeader title="7th CPC Pay Matrix" subtitle="Government pay levels and basic pay cells (eHRMS)." />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="Pay Matrix Levels">
        <DataTable
          columns={[
            { key: "level", label: "Level", align: "right" },
            { key: "payGrade", label: "Pay Grade" },
            { key: "cell", label: "Cell", align: "right" },
            { key: "basic", label: "Basic Pay", align: "right" },
          ]}
          rows={rows}
        />
      </Card>
    </>
  );
}
