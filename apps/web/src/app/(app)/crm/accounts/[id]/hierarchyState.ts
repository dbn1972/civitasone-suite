/**
 * Loader-state classifier for the account hierarchy panels. Keeps the
 * "empty vs failed to load" decision out of the page markup so a failed
 * children/ancestors fetch is never rendered as "No child accounts" /
 * "top-level account" (UX-001 empty-vs-error).
 */
export type HierarchyState = "error" | "empty" | "data";

export function hierarchyState(result: { source: string; data: readonly unknown[] }): HierarchyState {
  if (result.source === "error") return "error";
  return result.data.length > 0 ? "data" : "empty";
}
