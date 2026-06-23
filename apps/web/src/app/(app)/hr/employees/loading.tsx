import { PageHeader } from "../../../_components/ds";

export default function HREmployeesLoading() {
  return (
    <>
      <PageHeader
        title="Employee Directory"
        subtitle="All staff, grades and posting locations."
      />
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <div className="mx-auto max-w-7xl animate-pulse space-y-5">
          <div className="flex gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 flex-1 rounded-xl bg-slate-200" />
            ))}
          </div>
          <div className="h-80 rounded-xl bg-slate-200" />
        </div>
      </main>
    </>
  );
}
