import { PageHeader, Card } from "@/app/_components/ds";
import { RefundDecideForm } from "./RefundDecideForm";

export default function RefundDecidePage({ params }: { params: { id: string } }) {
  const refundId = params.id;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Decide Refund"
        subtitle="Approve or reject a pending refund. The deciding officer must differ from the officer who raised it."
        back="/revenue/refunds"
      />

      <Card title="Refund" padding>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--ink2)" }}>
          Refund ID: <span className="mono">{refundId}</span>
        </p>
        <RefundDecideForm refundId={refundId} />
      </Card>
    </main>
  );
}
