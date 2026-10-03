import type { ReactNode } from "react";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "./LinkTiles";
import { PageHeader } from "./ds";

export interface ModuleHubLink { href: string; label: string; note?: string; badge?: NavTile["badge"] }
export interface ModuleHubGroup { heading: string; links: ModuleHubLink[] }

interface ModuleHubProps {
  /** Accepts ReactNode so a bare acronym can carry an inline `Term` glossary tooltip. */
  title: ReactNode;
  description: ReactNode;
  /** Flat tile list (most modules). Ignored for layout when `groups` is given. */
  links?: ModuleHubLink[];
  /**
   * Optional headed groups (GAP-ASSETS-HOME-01): one LinkTiles grid per group,
   * so a hub with many tiles separates actions from read-only registers.
   */
  groups?: ModuleHubGroup[];
  children?: ReactNode;
  /** Optional Help Centre slug for a "How this works" link. */
  help?: string;
}

function toTiles(links: ModuleHubLink[]): NavTile[] {
  return links.map((link) => ({
    title: link.label,
    href: link.href,
    description: link.note,
    ...(link.badge ? { badge: link.badge } : {}),
  }));
}

export function ModuleHub({ title, description, links = [], groups, children, help }: ModuleHubProps) {

  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader title={title} subtitle={description} help={help} />
      {children}
      {groups && groups.length > 0 ? (
        groups.map((group, i) => (
          <section key={group.heading} aria-labelledby={`hub-group-${i}`} style={{ marginTop: i === 0 ? 0 : 22 }}>
            <h2 id={`hub-group-${i}`} style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>{group.heading}</h2>
            <LinkTiles tiles={toTiles(group.links)} columns="three" />
          </section>
        ))
      ) : (
        <LinkTiles tiles={toTiles(links)} columns="three" />
      )}
    </div>
  );
}
