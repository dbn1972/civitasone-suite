"use client";

export default function CitizenError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-4" role="alert" aria-live="assertive">
        <h2 className="text-lg font-semibold text-red-600">Something went wrong in Citizen Services</h2>
        <p className="text-sm text-slate-500">{error.message || "An unexpected error occurred while loading this page."}</p>
        <button className="btn ghost" style={{ minHeight: 44 }} onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
