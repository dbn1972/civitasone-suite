import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { PageHeader } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PrintButton } from "./PrintButton";

type SlipComponent = { code: string; name: string; type: string; amountMinor: number };
type Slip = {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeNo?: string;
  department?: string;
  designation?: string;
  payPeriod: string;
  basicMinor: number;
  grossMinor: number;
  totalDeductionsMinor: number;
  netMinor: number;
  components: SlipComponent[];
  bankAccount?: string;
  paidDate?: string;
};

async function getSlip(id: string): Promise<LoaderResult<Slip | null>> {
  return fetchJson<unknown, Slip | null>(`/api/v1/payroll/slips/${id}`, null, {
    telemetryKey: "payroll.slip",
    mapResponse: (p) => (p && typeof p === "object" ? p as Slip : null),
  });
}

function fmt(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

export default async function SalarySlipPage({ params }: { params: { id: string } }) {
  const { data: slip, source } = await getSlip(params.id);
  if (!slip) notFound();

  const earnings = slip.components.filter((c) => c.type === "earning");
  const deductions = slip.components.filter((c) => c.type === "deduction");

  return (
    <main className="page-main wrap" style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <PageHeader title="Salary Slip" back="/hr/payroll/salary-slips" />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href={`/hr/payroll/slips/${params.id}`} className="btn secondary" style={{ minHeight: 44 }}>📊 Dashboard View</Link>
          <PrintButton />
        </div>
      </div>
      <DataSourceBadge source={source} />

      <div id="salary-slip" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 32, fontFamily: "system-ui" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24, borderBottom: "2px solid #0f172a", paddingBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>SALARY SLIP</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--color-text-muted)" }}>
            Pay Period: <strong>{slip.payPeriod}</strong>
          </p>
        </div>

        {/* Employee details */}
        <table style={{ width: "100%", fontSize: 13, marginBottom: 20 }}>
          <tbody>
            <tr>
              <td style={{ padding: "4px 0" }}><strong>Employee:</strong> {slip.employeeName ?? slip.employeeId}</td>
              <td style={{ padding: "4px 0" }}><strong>Emp No:</strong> {slip.employeeNo ?? "—"}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0" }}><strong>Department:</strong> {slip.department ?? "—"}</td>
              <td style={{ padding: "4px 0" }}><strong>Designation:</strong> {slip.designation ?? "—"}</td>
            </tr>
            {slip.bankAccount && (
              <tr>
                <td style={{ padding: "4px 0" }}><strong>Bank A/C:</strong> {slip.bankAccount}</td>
                <td style={{ padding: "4px 0" }}><strong>Paid on:</strong> {slip.paidDate ?? "—"}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Earnings & Deductions side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", color: "var(--good)", borderBottom: "1px solid var(--goodbd)", paddingBottom: 4, marginBottom: 8 }}>Earnings</h3>
            <table style={{ width: "100%", fontSize: 13 }}>
              <tbody>
                {earnings.map((c) => (
                  <tr key={c.code}>
                    <td style={{ padding: "3px 0" }}>{c.name}</td>
                    <td style={{ padding: "3px 0", textAlign: "right", fontFamily: "monospace" }}>{fmt(c.amountMinor)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--color-border)", fontWeight: 700 }}>
                  <td style={{ padding: "6px 0 0" }}>Gross Earnings</td>
                  <td style={{ padding: "6px 0 0", textAlign: "right", fontFamily: "monospace" }}>{fmt(slip.grossMinor)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", color: "var(--bad)", borderBottom: "1px solid var(--badbd)", paddingBottom: 4, marginBottom: 8 }}>Deductions</h3>
            <table style={{ width: "100%", fontSize: 13 }}>
              <tbody>
                {deductions.map((c) => (
                  <tr key={c.code}>
                    <td style={{ padding: "3px 0" }}>{c.name}</td>
                    <td style={{ padding: "3px 0", textAlign: "right", fontFamily: "monospace" }}>{fmt(c.amountMinor)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--color-border)", fontWeight: 700 }}>
                  <td style={{ padding: "6px 0 0" }}>Total Deductions</td>
                  <td style={{ padding: "6px 0 0", textAlign: "right", fontFamily: "monospace" }}>{fmt(slip.totalDeductionsMinor)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Net Pay */}
        <div style={{ marginTop: 24, padding: "12px 16px", background: "var(--goodbg)", borderRadius: 8, border: "1px solid var(--goodbd)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--good)" }}>NET PAY (Take Home)</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: "var(--good)", fontFamily: "monospace" }}>{fmt(slip.netMinor)}</span>
        </div>

        {/* Footer */}
        <p style={{ marginTop: 20, fontSize: 11, color: "var(--color-text-muted)", textAlign: "center" }}>
          This is a system-generated salary slip. No signature required.
        </p>
      </div>
    </main>
  );
}
