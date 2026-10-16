import { notFound } from "next/navigation";
import { isDevLoginEnabled } from "@/lib/auth/env";
import { DevLoginForm } from "./DevLoginForm";

export const dynamic = "force-dynamic";

/**
 * GAP-AUTH-DEV-05: replaced all inline CSSProperties hex literals with
 * Tailwind utility classes (the DS token layer for this project).
 */
export default function DevLoginPage({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  if (!isDevLoginEnabled()) notFound();
  const next = searchParams?.next ?? "";
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 flex items-center justify-center p-6">
      <style>{`
        .devlogin-label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: #334155; }
        .devlogin-label-hint { font-weight: 400; color: #64748b; }
        .devlogin-input { width: 100%; padding: 11px 12px; margin-bottom: 16px; font-size: 14px; border: 1px solid #cbd5e1; border-radius: 9px; box-sizing: border-box; color: #0f172a; background: #fff; }
        .devlogin-input:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; border-color: #4f46e5; }
        .devlogin-btn { width: 100%; padding: 12px; font-size: 15px; font-weight: 600; color: #fff; background: #4f46e5; border: none; border-radius: 9px; cursor: pointer; }
        .devlogin-btn:hover { background: #4338ca; }
        .devlogin-btn:focus-visible { outline: 2px solid #1e1b4b; outline-offset: 2px; }
        .devlogin-btn:disabled { opacity: 0.6; cursor: progress; }
      `}</style>
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div role="note" className="mb-5 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2.5 text-center text-xs font-semibold text-amber-800">
          ⚠ TEST ENVIRONMENT — not for production data
        </div>
        <div aria-hidden="true" className="mx-auto mb-3.5 flex items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-bold tracking-wide text-white" style={{ width: 52, height: 52 }}>
          TEST
        </div>
        <h1 className="m-0 text-center text-2xl font-bold text-slate-900">CivitasOne Suite</h1>
        <p className="mb-6 mt-1.5 text-center text-sm text-slate-500">Government &amp; Enterprise Platform · Test Sign-in</p>
        {searchParams?.error ? (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            Invalid username or password. Please try again.
          </div>
        ) : null}
        <DevLoginForm next={next} />
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600">
          <div className="mb-1.5 font-bold text-slate-700">Demo accounts</div>
          <div className="flex justify-between py-0.5"><span className="font-semibold text-indigo-600 font-mono">dnayak</span><span>D. Nayak — HR Admin (Digital India)</span></div>
          <div className="flex justify-between py-0.5"><span className="font-semibold text-indigo-600 font-mono">superadmin</span><span>Full access · all modules</span></div>
          <div className="flex justify-between py-0.5"><span className="font-semibold text-indigo-600 font-mono">hrofficer</span><span>HR / Establishment Officer</span></div>
          <div className="flex justify-between py-0.5"><span className="font-semibold text-indigo-600 font-mono">officer</span><span>Finance · HR · Procurement</span></div>
          <div className="flex justify-between py-0.5"><span className="font-semibold text-indigo-600 font-mono">auditor</span><span>Audit (read-only)</span></div>
        </div>
      </div>
    </main>
  );
}
