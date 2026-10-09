/**
 * Pure display helpers for the recommendations module. Kept separate from
 * _data.ts (which imports the server-only apiClient) so "use client"
 * components such as nba/NbaTable can import them.
 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function formatSubjectRef(subjectId: string): string {
  const trimmed = subjectId.trim();
  if (trimmed === "") return "—";
  if (UUID_RE.test(trimmed)) return `#${trimmed.slice(0, 8)}`;
  return trimmed;
}
