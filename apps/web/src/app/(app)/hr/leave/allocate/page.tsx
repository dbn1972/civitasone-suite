"use client";

import Link from "next/link";
import { AllocateLeaveForm } from "./AllocateLeaveForm";

export default function AllocateLeavePage() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-2xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/hr" className="hover:text-slate-900">HR</Link>
          <span className="mx-2">/</span>
          <Link href="/hr/leave" className="hover:text-slate-900">Leave</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Allocate</span>
        </nav>
        <header>
          <h1 className="text-3xl font-semibold text-slate-900">Allocate Leave</h1>
          <p className="mt-1 text-sm text-slate-600">
            Grant leave entitlement to an employee for the financial year.
            Employees can only apply against an existing allocation.
          </p>
        </header>
        <AllocateLeaveForm />
      </section>
    </main>
  );
}
