import { PageHeader, Card } from "../../../_components/ds";

export default function HRDashboardLoading() {
  return (
    <>
      <PageHeader title="HR Dashboard" subtitle="People operations overview." />
      <Card title="Employees"><div className="animate-pulse h-48 bg-slate-100 rounded" /></Card>
    </>
  );
}
