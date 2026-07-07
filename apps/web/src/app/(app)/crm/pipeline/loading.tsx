export default function PipelineLoading() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-full animate-pulse space-y-5">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="h-9 w-56 rounded bg-slate-200" />
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-96 w-72 flex-shrink-0 rounded-xl bg-slate-200" />
          ))}
        </div>
      </div>
    </main>
  );
}
