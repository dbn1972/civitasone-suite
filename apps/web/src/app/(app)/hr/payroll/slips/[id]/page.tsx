import Link from "next/link";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatGrid, StatCard } from "../../../../../_components/ds";
import { getSlipById } from "../../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";

export default async function PayslipDetailPage({ params }: { params: { id: string } }) {
  const { data: slip, source } = await getSlipById(params.id);

  if (!slip) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Salary Slip" back="/hr/payroll/salary-slips" />
        <DataSourceBadge source={source} />
        <Card padding>
          <p style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
            Salary slip not found or could not be loaded.
          </p>
        </Card>
      </main>
    );
  }

  // The summary type has top-level gross/deductions/net — use those for display.
  // The API may return richer fields (earnings/deductions arrays, statutory breakdown)
  // that are not in the typed summary but may arrive in the JSON payload.
  const richSlip = slip as typeof slip & {
    earnings?: Array<{ code: string; name: string; amount: number }>;
    deductionItems?: Array<{ code: string; name: string; amount: number }>;
    statutory?: {
      pfEmployee?: number;
      pfEmployer?: number;
      esiEmployee?: number;
      esiEmployer?: number;
      tds?: number;
    };
  };

  const earnings = richSlip.earnings ?? [];
  const deductionItems = richSlip.deductionItems ?? [];
  const stat = richSlip.statutory;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Salary Slip — ${slip.payPeriod}`}
        subtitle={slip.employeeName}
        back="/hr/payroll/salary-slips"
        actions={
          <Link
            href={`/hr/payroll/salary-slips/${slip.id}`}
            className="btn secondary"
            style={{ minHeight: 44 }}
          >
            🖨 Printable Slip
          </Link>
          <a
            href={`/api/proxy/v1/payroll/slips/${slip.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn primary"
            style={{ minHeight: 44 }}
          >
            ⬇ Download PDF
          </a>
        }
      />

      <DataSourceBadge source={source} />

      {/* Summary cards */}
      <StatGrid>
        <StatCard icon="💰" iconBg="#e6f7f0" label="Gross Pay" value={formatMoney(slip.gross)} />
        <StatCard icon="📉" iconBg="#fff0f0" label="Total Deductions" value={formatMoney(slip.deductions)} />
        <StatCard icon="✅" iconBg="#e6f0ff" label="Net Pay" value={formatMoney(slip.net)} />
        <StatCard
          icon="📋"
          iconBg="#fffbe6"
          label="Status"
          value={slip.status.charAt(0).toUpperCase() + slip.status.slice(1)}
        />
      </StatGrid>

      {/* Employee details */}
      <Card title="Slip Details" padding>
        <div className="fields">
          <div className="field">
            <span className="lbl">Employee</span>
            <span className="val">
              <Link
                href={`/hr/employees/${slip.employeeId}`}
                style={{ color: "var(--primary-d)", fontWeight: 600 }}
              >
                {slip.employeeName}
              </Link>
            </span>
          </div>
          <div className="field">
            <span className="lbl">Department</span>
            <span className="val">{slip.department}</span>
          </div>
          <div className="field">
            <span className="lbl">Pay Period</span>
            <span className="val">{slip.payPeriod}</span>
          </div>
        </div>
      </Card>

      {/* Earnings table */}
      {earnings.length > 0 ? (
        <Card title="Earnings">
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Component</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map((row) => (
                <tr key={row.code}>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td className="num">{formatMoney(row.amount)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                <td colSpan={2}>Total Earnings</td>
                <td className="num">{formatMoney(slip.gross)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : (
        <Card title="Earnings" padding>
          <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
            Detailed earnings breakdown not available for this slip.
          </p>
        </Card>
      )}

      {/* Deductions table */}
      {deductionItems.length > 0 ? (
        <Card title="Deductions">
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Component</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {deductionItems.map((row) => (
                <tr key={row.code}>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td className="num">{formatMoney(row.amount)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                <td colSpan={2}>Total Deductions</td>
                <td className="num">{formatMoney(slip.deductions)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : (
        <Card title="Deductions" padding>
          <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
            Detailed deductions breakdown not available for this slip.
          </p>
        </Card>
      )}

      {/* Statutory breakdown */}
      <Card title="Statutory Contributions" padding>
        {stat ? (
          <div className="fields">
            {stat.pfEmployee != null && (
              <div className="field">
                <span className="lbl">PF (Employee)</span>
                <span className="val">{formatMoney(stat.pfEmployee)}</span>
              </div>
            )}
            {stat.pfEmployer != null && (
              <div className="field">
                <span className="lbl">PF (Employer)</span>
                <span className="val">{formatMoney(stat.pfEmployer)}</span>
              </div>
            )}
            {stat.esiEmployee != null && (
              <div className="field">
                <span className="lbl">ESI (Employee)</span>
                <span className="val">{formatMoney(stat.esiEmployee)}</span>
              </div>
            )}
            {stat.esiEmployer != null && (
              <div className="field">
                <span className="lbl">ESI (Employer)</span>
                <span className="val">{formatMoney(stat.esiEmployer)}</span>
              </div>
            )}
            {stat.tds != null && (
              <div className="field">
                <span className="lbl">TDS</span>
                <span className="val">{formatMoney(stat.tds)}</span>
              </div>
            )}
          </div>
        ) : (
          <p style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
            Statutory breakdown not available for this slip.
          </p>
        )}
      </Card>
    </main>
  );
}
