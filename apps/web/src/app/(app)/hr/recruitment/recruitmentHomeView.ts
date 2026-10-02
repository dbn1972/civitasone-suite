// Pure view-model helpers for the recruitment hub (page.tsx). Kept here so the stats
// fallback logic is unit-tested and the empty-vs-error guard is not tripped by it.

export type HubOpening = {
  status: string;
  vacancyType?: string;
  applicationsReceived: number;
  isPublished?: boolean;
};

export type HubStats = {
  totalOpenings: number;
  openVacancies: number;
  publishedVacancies: number;
  internshipsApprenticeships: number;
  applicationsInternal: number;
  applicationsPublic: number;
};

/** One value per stat card; `null` renders as "—" (StatCard), never as a misleading 0. */
export type HubCards = {
  total: number | null;
  open: number | null;
  applications: number | null;
  published: number | null;
  internships: number | null;
};

/**
 * - "api":         the dashboard endpoint answered; cards are tenant-wide figures.
 * - "derived":     the dashboard endpoint returned 403 (a permanent HR-only restriction -- a manager
 *                  still sees the department-scoped openings list). Cards are computed from that list.
 * - "unavailable": the dashboard failed for any other reason; cards show "—" and the page says so.
 */
export type HubStatsMode = "api" | "derived" | "unavailable";

export function deriveCardsFromOpenings(openings: readonly HubOpening[]): HubCards {
  return {
    total: openings.length,
    open: openings.filter((o) => o.status === "open").length,
    applications: openings.reduce((sum, o) => sum + (o.applicationsReceived || 0), 0),
    published: openings.filter((o) => o.isPublished === true).length,
    internships: openings.filter((o) => o.vacancyType === "internship" || o.vacancyType === "apprenticeship").length,
  };
}

export function buildHubCards(args: {
  statsSource: "api" | "error";
  statsStatus?: number;
  stats: HubStats;
  openings: readonly HubOpening[];
  openingsSource: "api" | "error";
}): { mode: HubStatsMode; cards: HubCards } {
  const { statsSource, statsStatus, stats, openings, openingsSource } = args;
  if (statsSource === "api") {
    return {
      mode: "api",
      cards: {
        total: stats.totalOpenings,
        open: stats.openVacancies,
        applications: stats.applicationsInternal + stats.applicationsPublic,
        published: stats.publishedVacancies,
        internships: stats.internshipsApprenticeships,
      },
    };
  }
  if (statsStatus === 403 && openingsSource === "api") {
    return { mode: "derived", cards: deriveCardsFromOpenings(openings) };
  }
  return {
    mode: "unavailable",
    cards: { total: null, open: null, applications: null, published: null, internships: null },
  };
}

export type RosterStatus = "none" | "draft" | "approved";

/** Normalises the API's free-text roster status to the three states the hub shows. */
export function normaliseRosterStatus(raw: string | undefined | null): RosterStatus {
  return raw === "draft" || raw === "approved" ? raw : "none";
}

export function isNoOpenings(openings: readonly unknown[]): boolean {
  return openings.length === 0;
}
