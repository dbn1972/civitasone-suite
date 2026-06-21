export default function HRAttendanceLoading() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="h-9 w-48 rounded bg-slate-200" />
        <div className="flex gap-3">
          <div className="h-10 w-36 rounded-md bg-slate-200" />
          <div className="h-10 w-40 rounded-md bg-slate-200" />
          <div className="h-10 w-20 rounded-md bg-slate-200" />
        </div>
        <div className="h-80 rounded-xl bg-slate-200" />
      </div>
    </main>
  );
}
