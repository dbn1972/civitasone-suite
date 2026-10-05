// GAP-CRM-CONTROL-TOWER-07: match the skeleton shape of sibling CRM routes
// (crm/accounts/loading.tsx) instead of a single line of text, so the loading
// state previews the stat grid and the two cards the page actually renders.
export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        {/* back link + title */}
        <div className="h-4 w-24 rounded bg-slate-200" />
        <div className="h-9 w-72 rounded bg-slate-200" />
        {/* two stat blocks (Regions, Exception volume) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="h-24 rounded-xl bg-slate-200" />
          <div className="h-24 rounded-xl bg-slate-200" />
        </div>
        {/* "Pipeline by region" card (table) */}
        <div className="h-64 rounded-xl bg-slate-200" />
        {/* "Exceptions" card */}
        <div className="h-48 rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}
