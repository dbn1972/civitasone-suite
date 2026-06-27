import type { ReactNode } from "react";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "./LinkTiles";
import { PageHeader } from "./ds";

interface ModuleHubProps {
  title: string;
  description: string;
  links: { href: string; label: string; note?: string }[];
  children?: ReactNode;
}

export function ModuleHub({ title, description, links, children }: ModuleHubProps) {
  const tiles: NavTile[] = links.map((link) => ({
    title: link.label,
    href: link.href,
    description: link.note,
  }));

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader title={title} subtitle={description} />
      {children}
      <LinkTiles tiles={tiles} columns="three" />
    </main>
  );
}
