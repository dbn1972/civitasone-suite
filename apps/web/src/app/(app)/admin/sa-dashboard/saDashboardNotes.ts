/**
 * Plain-language notes for the dashboard tiles that show a dash
 * (GAP-ADMIN-SA-DASHBOARD-03). Service-status problems are reported once, by the
 * DataSourceBadge on the page (-04), not repeated here: a dash alone reads as "zero" or "broken",
 * so say which figure is unavailable and why.
 */
export type TileAvailability = {
  usersAvailable: boolean;
  uptimeAvailable: boolean;
};

export function tileNotes(a: TileAvailability): string[] {
  const notes: string[] = [];
  const missing = [!a.usersAvailable && "Total Users", !a.uptimeAvailable && "Platform Uptime"].filter(Boolean) as string[];
  if (missing.length > 0) notes.push(`${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not reported by the platform yet.`);
  return notes;
}
