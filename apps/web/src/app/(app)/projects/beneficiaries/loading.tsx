// GAP-PROJECTS-BENEFICIARIES-04: the loading state was a single bare .skeleton
// block with no header or stat placeholders, so the page (header + 4 stat cards
// + register table) jumped on load. This mirrors that shape.
export default function Loading() {
  return (
    <div className="page-main wrap">
      <div className="animate-pulse space-y-6">
        <div className="space-y-3">
          <div className="h-8 w-56 rounded bg-slate-200" />
          <div className="h-4 w-full max-w-xl rounded bg-slate-200" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="h-96 rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}
