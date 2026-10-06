// GAP-PROJECTS-SCHEMES-DETAIL-05: the scheme detail page is a header, a 4-card
// StatGrid (Projects/Budget/Utilized %/Beneficiaries), a "Scheme Details" card
// and a linked-projects table. The old single bare `.skeleton` block matched
// none of that, so the page jumped on load. Mirror the real page shape.
export default function SchemeDetailLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="h-9 w-96 rounded bg-slate-200" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="h-56 rounded-xl bg-slate-200" />
        <div className="h-64 rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}
