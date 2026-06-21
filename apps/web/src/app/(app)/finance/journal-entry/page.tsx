import Link from "next/link";
import { JournalEntryForm } from "./JournalEntryForm";

export default function Page() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/finance" className="hover:text-slate-900">Finance</Link>
          <span className="mx-2">/</span>
          <Link href="/finance/accounting/general-ledger" className="hover:text-slate-900">General Ledger</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Journal Entry</span>
        </nav>

        <header>
          <h1 className="text-3xl font-semibold text-slate-900">Journal Entry</h1>
          <p className="mt-1 text-sm text-slate-600">Create balanced accounting entries with voucher context.</p>
        </header>

        <JournalEntryForm />
      </section>
    </main>
  );
}
