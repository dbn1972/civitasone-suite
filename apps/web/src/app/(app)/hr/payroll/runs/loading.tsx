import { PageHeader } from "../../../../_components/ds";

export default function PayrollRunsLoading() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Payroll Runs"
        subtitle="Monthly salary processing and statutory run status."
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
    </main>
  );
}
