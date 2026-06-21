import type { ReactNode } from "react";

interface PageShellProps {
  title: string;
  description: string;
  breadcrumb?: ReactNode;
  children: ReactNode;
}

export function PageShell({ title, description, breadcrumb, children }: PageShellProps) {
  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-4">
        {breadcrumb && (
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            {breadcrumb}
          </nav>
        )}
        <header>
          <h1 className="text-3xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </header>
        {children}
      </section>
    </main>
  );
}
