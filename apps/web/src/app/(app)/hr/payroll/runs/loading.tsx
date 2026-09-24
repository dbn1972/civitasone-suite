import { PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

export default async function PayrollRunsLoading() {
  const t = await getTranslations("payrollRuns");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll"
        backLabel="Payroll"
      />
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              style={{ height: 80, borderRadius: 12, background: "var(--panel)" }}
            />
          ))}
        </div>
        <div style={{ height: 40, borderRadius: 8, background: "var(--panel)", maxWidth: 320 }} />
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <div key={n} style={{ height: 48, borderRadius: 8, background: "var(--panel)" }} />
        ))}
      </div>
    </div>
  );
}
