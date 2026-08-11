import { PageHeader, Card } from "../../../../_components/ds";

function getCurrentFY(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const start = month >= 4 ? year : year - 1;
  const end = (start + 1) % 100;
  return `${start}-${String(end).padStart(2, "0")}`;
}

export default function TaxConfigPage() {
  const fy = getCurrentFY();
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Income Tax Configuration" subtitle="TDS slabs and deduction limits used by the payroll engine for monthly tax computation." back="/hr/payroll" backLabel="Payroll" />

      <div className="grid g-2">
        <Card title={`New Tax Regime — Default from FY ${fy}`} padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <thead><tr><th>Slab (Annual)</th><th>Rate</th></tr></thead>
            <tbody>
              <tr><td>Up to ₹3,00,000</td><td>Nil</td></tr>
              <tr><td>₹3,00,001 – ₹7,00,000</td><td>5%</td></tr>
              <tr><td>₹7,00,001 – ₹10,00,000</td><td>10%</td></tr>
              <tr><td>₹10,00,001 – ₹12,00,000</td><td>15%</td></tr>
              <tr><td>₹12,00,001 – ₹15,00,000</td><td>20%</td></tr>
              <tr><td>Above ₹15,00,000</td><td>30%</td></tr>
            </tbody>
          </table>
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>Standard deduction: ₹75,000. Rebate u/s 87A up to ₹7L taxable income.</p>
        </Card>

        <Card title="Old Tax Regime (opt-in)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <thead><tr><th>Slab (Annual)</th><th>Rate</th></tr></thead>
            <tbody>
              <tr><td>Up to ₹2,50,000</td><td>Nil</td></tr>
              <tr><td>₹2,50,001 – ₹5,00,000</td><td>5%</td></tr>
              <tr><td>₹5,00,001 – ₹10,00,000</td><td>20%</td></tr>
              <tr><td>Above ₹10,00,000</td><td>30%</td></tr>
            </tbody>
          </table>
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>Allows: Sec 80C (₹1.5L), 80D (₹25K/50K), HRA exemption, Sec 24 (₹2L).</p>
        </Card>

        <Card title="Deduction Limits (Old Regime)" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <thead><tr><th>Section</th><th>Limit</th><th>Description</th></tr></thead>
            <tbody>
              <tr><td>80C</td><td>₹1,50,000</td><td>PPF, ELSS, LIC, tuition, home loan principal</td></tr>
              <tr><td>80D</td><td>₹25,000 (₹50K senior)</td><td>Health insurance premium</td></tr>
              <tr><td>80CCD(1B)</td><td>₹50,000</td><td>NPS additional contribution</td></tr>
              <tr><td>80TTA</td><td>₹10,000</td><td>Savings bank interest</td></tr>
              <tr><td>Sec 24</td><td>₹2,00,000</td><td>Home loan interest</td></tr>
              <tr><td>HRA</td><td>Actual / formula</td><td>Min of: actual HRA, rent-10% salary, 50%/40% salary</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Surcharge & Cess" padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <thead><tr><th>Income</th><th>Surcharge</th></tr></thead>
            <tbody>
              <tr><td>₹50L – ₹1Cr</td><td>10%</td></tr>
              <tr><td>₹1Cr – ₹2Cr</td><td>15%</td></tr>
              <tr><td>Above ₹2Cr</td><td>25%</td></tr>
            </tbody>
          </table>
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--mut)" }}>Health & Education Cess: 4% on tax + surcharge (all slabs).</p>
        </Card>
      </div>

      <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 13 }}>
        FY {fy} slabs are active. To update tax slabs after a Union Budget change, modify the slab configuration in the payroll engine. The rates above are applied automatically during monthly payroll computation.
      </p>
    </main>
  );
}
