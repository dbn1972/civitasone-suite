import type { ReactNode } from "react";
import type { ResourceState } from "@/app/_data/useResource";

export interface ResourceProps<T> {
  resource: ResourceState<T>;
  /** Rendered when the fetch genuinely failed. Required — see UX-001. */
  error: ReactNode;
  /** Rendered when the fetch succeeded but returned nothing. Required. */
  empty: ReactNode;
  /** Rendered when there is real, non-empty data. */
  children: (data: T) => ReactNode;
}

/**
 * The render half of the UX-001 contract (see ../../_data/useResource.ts).
 * `error` and `empty` are required props with no defaults, so a page cannot
 * pass only one of them and silently fall through to the other — a fetch
 * failure can no longer render as an honest-looking empty state, or vice
 * versa, without a reviewer seeing both branches written out at the call
 * site.
 */
export function Resource<T>({ resource, error, empty, children }: ResourceProps<T>) {
  if (resource.status === "error") return <>{error}</>;
  if (resource.status === "empty") return <>{empty}</>;
  return <>{children(resource.data)}</>;
}
