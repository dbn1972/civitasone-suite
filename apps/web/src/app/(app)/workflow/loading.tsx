export default function WorkflowLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading workflow…</span>
      <div className="h-9 w-72 rounded bg-slate-200" />
      <div className="mt-2 h-4 w-[28rem] max-w-full rounded bg-slate-200" />
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-200" />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-56 rounded-xl bg-slate-200" />
        <div className="h-56 rounded-xl bg-slate-200" />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-200" />
        ))}
      </div>
    </div>
  );
}
