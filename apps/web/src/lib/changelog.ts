export const CURRENT_VERSION = "0.2.0";

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.2.0",
    date: "2026-07-03",
    title: "Module configuration + offline sync",
    highlights: [
      "Turn modules on/off per office",
      "Works offline — changes sync when back online",
      "Keyboard shortcuts (press ? to see)",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-06-15",
    title: "Initial release",
    highlights: [
      "Finance, HR, Procurement modules",
      "Getting Started wizard",
      "Mobile app with offline sync",
    ],
  },
];

/**
 * Compare two semver version strings. Returns:
 * -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

/** Returns true if the user has not yet seen the current version. */
export function hasUnseenUpdate(lastSeenVersion: string | null): boolean {
  if (!lastSeenVersion) return true;
  return compareVersions(lastSeenVersion, CURRENT_VERSION) < 0;
}

/** Get the latest changelog entry. */
export function getLatestEntry(): ChangelogEntry | undefined {
  return CHANGELOG[0];
}
