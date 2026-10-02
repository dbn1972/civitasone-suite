/** How many sessions the list asks the API for (GAP-ASSETS-VERIFICATION-05). */
export const SESSION_LIMIT = 50;

/** True when the list is full, i.e. older sessions may exist beyond the page. */
export function isAtSessionLimit(count: number): boolean {
  return count >= SESSION_LIMIT;
}

export type VerificationItem = {
  id: string;
  assetId: string;
  condition: string;
  foundAtLocation?: boolean | null;
  remarks?: string | null;
};

/** Counts for the session-detail summary strip (GAP-ASSETS-VERIFICATION-02). */
export function summariseItems(items: VerificationItem[]): { total: number; found: number; missing: number } {
  const found = items.filter((i) => i.foundAtLocation !== false).length;
  return { total: items.length, found, missing: items.length - found };
}
