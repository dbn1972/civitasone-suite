"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ProjectDetailNavProps {
  projectId: string;
}

const NAV_TABS = [
  { label: "Overview", segment: "" },
  { label: "Tasks", segment: "tasks" },
  { label: "Team", segment: "members" },
  { label: "Risks", segment: "risks" },
] as const;

/**
 * GAP-PROJECTS-DETAIL-06: route-based project sub-page tabs. Replaces the
 * plain button card in [id]/page.tsx that offered no active-route feedback.
 * Uses Next.js Link for soft navigation; highlights the current route via
 * aria-current="page" plus a CSS override that mirrors the .subnav a:focus-visible
 * style (no custom class needed).
 *
 * Rendered in [id]/layout.tsx so it appears on every sub-page (overview,
 * tasks, team, risks) without each page having to repeat the markup.
 */
export function ProjectDetailNav({ projectId }: ProjectDetailNavProps) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  function isActive(segment: string): boolean {
    if (segment === "") {
      // Overview is the project root: active only on exact match so that
      // /projects/[id]/tasks does not also light it up.
      return pathname === base;
    }
    return pathname === `${base}/${segment}` || pathname.startsWith(`${base}/${segment}/`);
  }

  return (
    <nav aria-label="Project sections" className="subnav">
      {NAV_TABS.map(({ label, segment }) => {
        const href = segment ? `${base}/${segment}` : base;
        const active = isActive(segment);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            style={active ? { background: "var(--line2)", color: "var(--ink)" } : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
