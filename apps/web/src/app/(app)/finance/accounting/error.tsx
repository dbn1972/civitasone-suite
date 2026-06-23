"use client";

import Link from "next/link";

interface AccountingErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AccountingError({ error, reset }: AccountingErrorProps) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center">
      {/* Warning icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-14 w-14 text-amber-500"
        aria-hidden="true"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-slate-800">
          Accounting section error
        </h2>
        <p className="max-w-md text-slate-500">
          {error.message || "An unexpected error occurred in the Accounting section."}
        </p>
        {error.digest && (
          <p className="text-xs text-slate-400">Error ID: {error.digest}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Try again
        </button>
        <Link
          href="/finance"
          className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          Back to Finance
        </Link>
      </div>
    </main>
  );
}
