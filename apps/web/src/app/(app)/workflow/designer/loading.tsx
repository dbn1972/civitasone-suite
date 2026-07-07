export default function DesignerLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading BPMN Designer…</span>
      <div className="h-9 w-72 rounded bg-slate-200" />
      <div className="mt-2 h-4 w-96 max-w-full rounded bg-slate-200" />
      <div className="mt-5 flex gap-4" style={{ height: "calc(100vh - 200px)" }}>
        <div className="w-56 shrink-0 rounded-xl bg-slate-200" />
        <div className="flex-1 rounded-xl bg-slate-200" />
        <div className="w-72 shrink-0 rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}
