export default function Loading() {
  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-44 rounded bg-slate-200" />
        <div className="h-9 w-52 rounded bg-slate-200" />
        <div className="h-80 rounded-xl bg-slate-200" />
      </div>
    </main>
  );
}
