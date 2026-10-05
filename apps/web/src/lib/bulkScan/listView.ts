/**
 * Empty vs error vs ready for every Bulk scan list. A failed load is NEVER "empty" (empty-vs-error rule); kept in a pure
 * module so page-level files carry no `.length === 0` checks.
 */
export type ListView = "error" | "empty" | "ready";

export function listView(result: { source: string; data: { items: readonly unknown[] } | readonly unknown[] }): ListView {
  if (result.source === "error") return "error";
  const items = Array.isArray(result.data) ? result.data : (result.data as { items: readonly unknown[] }).items;
  return items.length === 0 ? "empty" : "ready";
}

/** Same rule for a client-side fetch state (no loader `source`). */
export function clientListView(state: { error: boolean; loading: boolean; count: number }): "loading" | "error" | "empty" | "ready" {
  if (state.loading) return "loading";
  if (state.error) return "error";
  return state.count === 0 ? "empty" : "ready";
}
