import { PageHeader, Card } from "../../../_components/ds";

export default function PayMatrixLoading() {
  return (
    <>
      <PageHeader title="7th CPC Pay Matrix" subtitle="Loading pay matrix…" />
      <Card title="Pay Matrix Levels"><div className="animate-pulse h-48 bg-slate-100 rounded" /></Card>
    </>
  );
}
