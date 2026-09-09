import type { LoaderResult, LoaderSource } from "./apiClient";

/**
 * UX-001 — one shared contract for turning a completed fetch into UI.
 *
 * `fetchJson()` (./apiClient.ts) already tells the truth: on any failure
 * (missing config, missing auth, non-2xx, bad payload, network error) it
 * resolves `{ data: empty, source: "error" }` rather than throwing. The bug
 * this closes was never in the fetch layer — it was that individual pages
 * re-derived their own "is there anything to show" check
 * (`data.length === 0`) and, in the large majority of them, never also
 * looked at `source`. A real outage and a tenant with zero rows rendered
 * pixel-identical: zero stat cards, a cheerful "create your first…" prompt.
 *
 * `useResource` turns a `LoaderResult<T>` into exactly one of three states.
 * It is a plain function, not a React hook — these run inside async Server
 * Component `page.tsx` files, which cannot call hooks. Pair it with
 * `<Resource>` (../_components/ds/Resource.tsx), whose `error` and `empty`
 * render props are both required, so a page cannot compile without deciding
 * what each one looks like — it can still choose to render the same thing
 * for both, but that is now a deliberate, visible choice at the call site
 * instead of an accidental fallthrough.
 */
export type ResourceState<T> =
  | { status: "error"; data: T; source: "error" }
  | { status: "empty"; data: T; source: LoaderSource }
  | { status: "ready"; data: T; source: LoaderSource };

function defaultIsEmpty<T>(data: T): boolean {
  return Array.isArray(data) ? data.length === 0 : false;
}

export function useResource<T>(
  result: LoaderResult<T>,
  isEmpty: (data: T) => boolean = defaultIsEmpty,
): ResourceState<T> {
  if (result.source === "error") {
    return { status: "error", data: result.data, source: "error" };
  }
  if (isEmpty(result.data)) {
    return { status: "empty", data: result.data, source: result.source };
  }
  return { status: "ready", data: result.data, source: result.source };
}

/**
 * Same three-way decision for a page that depends on more than one
 * `LoaderResult` (e.g. workflow/definitions needs both `definitions` and
 * `templates`). Any real fetch error among the inputs wins over "empty" —
 * a page must not tell the clerk "nothing configured" when one of the two
 * calls it needed actually failed. `data`/`isEmpty` describe the shape the
 * page renders (usually just one of the inputs, or a merge of them).
 */
export function combineResourceState<T>(
  results: Array<LoaderResult<unknown>>,
  data: T,
  isEmpty: (data: T) => boolean = defaultIsEmpty,
): ResourceState<T> {
  if (results.some((r) => r.source === "error")) {
    return { status: "error", data, source: "error" };
  }
  if (isEmpty(data)) {
    return { status: "empty", data, source: "api" };
  }
  return { status: "ready", data, source: "api" };
}
