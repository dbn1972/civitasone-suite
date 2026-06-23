import { PageHeader } from "../../../_components/ds";

export default function HRPayrollLoading() {
  return (
    <>
      <PageHeader
        title="Payroll Runs"
        subtitle="Monthly salary processing and statutory run status."
      />
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <div className="mx-auto max-w-7xl animate-pulse space-y-5">
          <div className="h-32 rounded-xl bg-slate-200" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-slate-200" />
            ))}
          </div>
          <div className="h-72 rounded-xl bg-slate-200" />
        </div>
      </main>
    </>
  );
}
