import { PageHeader, Card } from "@/app/_components/ds";
import { WriteOffDecideForm } from "./WriteOffDecideForm";

export default function WriteOffDecidePage({ params }: { params: { id: string } }) {
  const writeOffId = params.id;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Decide Write-off"
        subtitle="Approve or reject a pending write-off. The deciding officer must differ from the officer who raised it."
        back="/revenue/write-offs"
      />

      <Card title="Write-off" padding>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--ink2)" }}>
          Write-off ID: <span className="mono">{writeOffId}</span>
        </p>
        <WriteOffDecideForm writeOffId={writeOffId} />
      </Card>
    </main>
  );
}
