import Link from "next/link";
import type { ReactNode } from "react";
import { PageShell } from "./PageShell";

interface ModuleHubProps {
  title: string;
  description: string;
  links: { href: string; label: string; note?: string }[];
  children?: ReactNode;
}

export function ModuleHub({ title, description, links, children }: ModuleHubProps) {
  return (
    <PageShell title={title} description={description}>
      {children}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow"
          >
            <h2 className="font-semibold text-slate-900">{link.label}</h2>
            {link.note ? <p className="mt-1 text-sm text-slate-600">{link.note}</p> : null}
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
