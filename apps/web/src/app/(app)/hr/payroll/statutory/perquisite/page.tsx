import { PageHeader, Card, EmptyState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { EmployeeFyLookup } from "./EmployeeFyLookup";
import { PerquisiteComponentForm } from "./PerquisiteComponentForm";

type PerquisiteLine = {
  sl: number;
  nature: string;
  description?: string;
  taxableValueMinor: number;
  value: number;
};

type Form12BAResponse = {
  formType: string;
  fy: string;
  assessmentYear: string;
  employer: { name: string; tan: string; pan: string };
  employee: { employeeId: string; pan: string; name: string; panFlag: string };
  perquisites: PerquisiteLine[];
  totalPerquisitesMinor: number;
  totalPerquisites: number;
  note: string;
};

async function getForm12BA(employeeId: string, fy: string): Promise<LoaderResult<Form12BAResponse | null>> {
  return fetchJson<Form12BAResponse, Form12BAResponse | null>(
    `/api/v1/payroll/statutory/form12ba?employeeId=${encodeURIComponent(employeeId)}&fy=${encodeURIComponent(fy)}`,
    null,
    {
      telemetryKey: "payroll.statutory.form12ba",
      mapResponse: (p) => (p && Array.isArray(p.perquisites) ? p : null),
    },
  );
}

export default async function PerquisitePage({ searchParams }: { searchParams?: { employeeId?: string; fy?: string } }) {
  const employeeId = searchParams?.employeeId?.trim();
  const fy = searchParams?.fy?.trim();
  const canLookup = !!employeeId && !!fy;

  const result = canLookup ? await getForm12BA(employeeId!, fy!) : null;
  const source = result?.source ?? "api";
  const form12ba = result?.data ?? null;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Perquisites & Form 12BA"
        subtitle="Itemised perquisite components (Sec 17(2)) and the statutory Form 12BA statement."
        back="/hr/payroll/statutory"
      />
      {canLookup && source === "error" && <DataSourceBadge source="error" />}

      <EmployeeFyLookup employeeId={employeeId ?? ""} fy={fy ?? ""} />

      <PerquisiteComponentForm defaultEmployeeId={employeeId ?? ""} defaultFy={fy ?? ""} />

      <Card title="Form 12BA">
        {!canLookup ? (
          <EmptyState
            icon="📄"
            title="Select an employee and financial year"
            message="Enter an employee ID and financial year above to view their Form 12BA statement of perquisites."
          />
        ) : !form12ba ? (
          <EmptyState
            icon="📄"
            title="No Form 12BA data"
            message={`No perquisite data found for the given employee and FY ${fy}.`}
          />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>Employee</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{form12ba.employee.name || form12ba.employee.employeeId}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>PAN</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{form12ba.employee.pan || form12ba.employee.panFlag}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>Total Perquisites</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{formatMoney(form12ba.totalPerquisitesMinor)}</div>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption className="sr-only">Itemised perquisites under Section 17(2), Form 12BA</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left", padding: "6px 8px", fontSize: 13 }}>Sl.</th>
                  <th scope="col" style={{ textAlign: "left", padding: "6px 8px", fontSize: 13 }}>Nature</th>
                  <th scope="col" style={{ textAlign: "left", padding: "6px 8px", fontSize: 13 }}>Description</th>
                  <th scope="col" style={{ textAlign: "right", padding: "6px 8px", fontSize: 13 }}>Taxable Value</th>
                </tr>
              </thead>
              <tbody>
                {form12ba.perquisites.map((p) => (
                  <tr key={p.sl}>
                    <td style={{ padding: "6px 8px", fontSize: 13 }}>{p.sl}</td>
                    <td style={{ padding: "6px 8px", fontSize: 13 }}>{p.nature}</td>
                    <td style={{ padding: "6px 8px", fontSize: 13 }}>{p.description || "—"}</td>
                    <td style={{ padding: "6px 8px", fontSize: 13, textAlign: "right" }}>{formatMoney(p.taxableValueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: "var(--ink2)" }}>{form12ba.note}</p>
          </div>
        )}
      </Card>
    </main>
  );
}
