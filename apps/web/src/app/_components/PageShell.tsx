import type { ReactNode } from "react";
import Link from "next/link";

interface PageShellProps {
  title: string;
  description: string;
  breadcrumb?: ReactNode;
  children: ReactNode;
  /** Optional Help Centre slug for a "How this works" link. */
  help?: string;
}

export function PageShell({ title, description, breadcrumb, children, help }: PageShellProps) {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-4">
        {breadcrumb && (
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            {breadcrumb}
          </nav>
        )}
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">{title}</h1>
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          </div>
          {help && (
            <Link
              href={`/help/${help}`}
              className="btn ghost"
              aria-label="How this works — plain-language help"
            >
              ❓ How this works
            </Link>
          )}
        </header>
        {children}
      </section>
    </main>
  );
}
