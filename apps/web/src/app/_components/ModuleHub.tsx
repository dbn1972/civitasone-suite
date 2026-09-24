import type { ReactNode } from "react";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "./LinkTiles";
import { PageHeader } from "./ds";

interface ModuleHubProps {
  /** Accepts ReactNode so a bare acronym can carry an inline `Term` glossary tooltip. */
  title: ReactNode;
  description: ReactNode;
  links: { href: string; label: string; note?: string }[];
  children?: ReactNode;
  /** Optional Help Centre slug for a "How this works" link. */
  help?: string;
}

export function ModuleHub({ title, description, links, children, help }: ModuleHubProps) {
  const tiles: NavTile[] = links.map((link) => ({
    title: link.label,
    href: link.href,
    description: link.note,
  }));

  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader title={title} subtitle={description} help={help} />
      {children}
      <LinkTiles tiles={tiles} columns="three" />
    </div>
  );
}
