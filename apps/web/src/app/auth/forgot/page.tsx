import Link from "next/link";
import { PageShell } from "../../_components/PageShell";

export default function Page() {
  return (
    <PageShell title="Forgot Password" description="Enter your email and we will send reset instructions.">
      <section className="mx-auto mt-8 max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <form className="mt-5 space-y-3">
          <input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="you@gov.in" type="email" />
          <button type="button" className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Send reset link</button>
        </form>
        <Link href="/auth/login" className="mt-4 inline-block text-sm font-medium text-indigo-700 hover:text-indigo-600">
          Back to sign in
        </Link>
      </section>
    </PageShell>
  );
}
