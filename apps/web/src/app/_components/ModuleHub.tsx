import type { ReactNode } from "react";
import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "./LinkTiles";
import { PageHeader } from "./ds";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";

export interface ModuleHubLink {
  href: string;
  label: string;
  note?: string;
  badge?: NavTile["badge"];
  /** Optional explicit tile icon (overrides LinkTiles' title/href inference). */
  icon?: string;
  /**
   * GAP-IDENTITY-HOME-02: when set, the tile is only shown to a session that
   * holds one of these roles. Links without `roles` are shown to everyone (so
   * every existing hub is unaffected). This is a UX convenience only — the
   * destination route's own layout gate remains the authoritative control.
   */
  roles?: string[];
}
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
    ...(link.icon ? { icon: link.icon } : {}),
    ...(link.badge ? { badge: link.badge } : {}),
  }));
}

/**
 * GAP-IDENTITY-HOME-02: drop any link whose `roles` the current session does
 * not satisfy. A link without `roles` is always kept, so hubs that don't opt
 * in are unchanged. The route layout gate stays authoritative; this just
 * avoids advertising a tile that would only bounce the user back.
 */
function visibleLinks(links: ModuleHubLink[]): ModuleHubLink[] {
  const sessionRoles = getSessionRoles();
  return links.filter((link) => !link.roles || hasAnyRole(sessionRoles, link.roles));
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
            <LinkTiles tiles={toTiles(visibleLinks(group.links))} columns="three" />
          </section>
        ))
      ) : (
        <LinkTiles tiles={toTiles(visibleLinks(links))} columns="three" />
      )}
    </div>
  );
}
