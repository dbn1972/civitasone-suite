"use client";

export default function StockLedgerError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <h2 className="text-lg font-semibold text-red-600">Failed to load stock ledger</h2>
        <p className="text-sm text-slate-500">{error.message}</p>
        <button className="btn ghost" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
