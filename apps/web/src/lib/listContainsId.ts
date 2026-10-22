/**
 * Does a list endpoint's response contain a row with this `id`? Used by the
 * "202 accepted -> poll the resource's own GET until the new row shows up"
 * flows (lib/useAcceptedWrite.ts, SF-15): the hrms-service list routes answer
 * either a bare array or a `{ data: [...] }` envelope.
 */
export function listContainsId(payload: unknown, id: string): boolean {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(rows) && rows.some((r) => (r as { id?: unknown } | null | undefined)?.id === id);
}
