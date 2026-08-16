export default function DedupCandidatesLoading() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-5xl animate-pulse space-y-5">
        {/* Back link + header skeleton */}
        <div className="h-4 w-32 rounded bg-slate-200" />
        <div className="h-9 w-64 rounded bg-slate-200" />
        <div className="h-4 w-96 rounded bg-slate-200" />
        {/* Pair card skeletons */}
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl bg-slate-200" style={{ height: 200 }} />
        ))}
      </div>
    </main>
  );
}
