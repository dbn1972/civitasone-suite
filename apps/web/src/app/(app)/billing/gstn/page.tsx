import { PageHeader, Card } from "../../../_components/ds";
import { GstnConsole } from "./GstnConsole";

export default function GstnConsolePage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="GSTN Console"
        subtitle="Submit GST returns, check filing status, and verify GSTINs against the Goods and Services Tax Network. Actions call an external government system — GSTN may be disabled in this environment."
        back="/billing"
      />

      <Card title="GSTN Actions" padding>
        <GstnConsole />
      </Card>
    </main>
  );
}
