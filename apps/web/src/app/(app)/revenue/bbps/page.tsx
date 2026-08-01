import { PageHeader, Card } from "@/app/_components/ds";
import { FetchBillForm } from "./FetchBillForm";
import { PayBillForm } from "./PayBillForm";

export default function BbpsPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="BBPS Bill Fetch & Pay"
        subtitle="Fetch an assessee's outstanding bill via Bharat Bill Payment System and record a BBPS payment against it."
        back="/revenue"
      />

      <Card title="About this screen" padding>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink2)" }}>
          BBPS requests are processed asynchronously by the biller adapter. Submitting a request here only
          hands it off to the queue and returns an acknowledgement (a message ID) — it does not return the
          fetched bill or payment confirmation on this screen. There is currently no status endpoint to poll
          for the outcome; check the assessee&apos;s Bills &amp; Demands or Collection Receipts screens once
          processing has completed.
        </p>
      </Card>

      <FetchBillForm />
      <PayBillForm />
    </main>
  );
}
