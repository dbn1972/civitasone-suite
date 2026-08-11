import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card } from "../../../../_components/ds";
import { getAttendanceRegularisations } from "../../../../_data/loaders";
import { RegularisationTable } from "./RegularisationTable";

export default async function AttendanceRegularisationPage() {
  const { data: regs, source } = await getAttendanceRegularisations();

  return (
    <>
      <PageHeader
        title="Attendance Regularisation"
        subtitle="Employee requests to correct attendance records."
        back="/hr/attendance"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="Regularisation Requests">
        <RegularisationTable regs={regs} source={source} />
      </Card>
    </>
  );
}
