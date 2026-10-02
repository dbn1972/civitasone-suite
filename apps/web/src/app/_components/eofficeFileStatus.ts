/**
 * Whether a linked eOffice file is still awaiting a decision. Only these
 * statuses count as "in flight"; a rejected, approved, closed or withdrawn
 * file must not lock the originating record's own approval controls.
 */
const IN_FLIGHT = new Set(["open", "in_progress", "pending"]);

export function normalizeFileStatus(status: string | null | undefined): string {
  return (status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isEofficeFileInFlight(status: string | null | undefined): boolean {
  return IN_FLIGHT.has(normalizeFileStatus(status));
}
