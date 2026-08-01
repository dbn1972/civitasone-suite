export default function GstnLoading() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-4xl animate-pulse space-y-5">
        <div className="h-4 w-32 rounded bg-slate-200" />
        <div className="h-9 w-64 rounded bg-slate-200" />
        <div className="h-80 rounded-xl bg-slate-200" />
      </div>
    </main>
  );
}
