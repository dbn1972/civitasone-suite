export default function FieldLoading() {
  return (
    <main
      className="min-h-screen bg-slate-50 p-6 md:p-8"
      style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-2">
          <div className="h-4 w-40 rounded bg-gray-200" style={{ animation: "pulse 2s infinite" }} />
          <div className="h-8 w-64 rounded bg-gray-200" style={{ animation: "pulse 2s infinite" }} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-3 h-4 w-24 rounded bg-gray-200" style={{ animation: "pulse 2s infinite" }} />
              <div className="h-8 w-32 rounded bg-gray-200" style={{ animation: "pulse 2s infinite" }} />
              <div className="mt-2 h-3 w-16 rounded bg-gray-200" style={{ animation: "pulse 2s infinite" }} />
            </div>
          ))}
        </div>
        <div className="h-96 w-full rounded-xl bg-gray-200" style={{ animation: "pulse 2s infinite" }} />
      </div>
    </main>
  );
}
