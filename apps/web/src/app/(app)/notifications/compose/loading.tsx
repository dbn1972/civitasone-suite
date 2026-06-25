export default function ComposeLoading() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="h-9 w-56 rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-80 rounded-xl bg-slate-200" />
          <div className="h-44 rounded-xl bg-slate-200" />
        </div>
      </div>
    </main>
  );
}
