export type DataSource = "api" | "error";

interface DataSourceBadgeProps {
  source: DataSource;
  /**
   * Copy shown for the "error" state.
   *
   * The default is deliberately honest: `source` is produced exclusively by
   * `fetchJson()` (src/app/_data/apiClient.ts), whose `LoaderSource` type is
   * the same two-value `"api" | "error"` union as this component's. On EVERY
   * failure branch it returns `{ data: empty, source: "error" }` — the empty
   * fallback the caller passed, never a cached payload. There is no
   * stale-cache path anywhere in the fetch layer, so the badge must never
   * imply saved/cached data is on screen.
   *
   * Pass `message` only to say something MORE specific and equally truthful
   * for a particular surface (e.g. `message="Couldn't load claims"`). If a
   * future loader ever adds a real stale-cache path, give it a third source
   * value rather than overloading "error" for two different meanings.
   */
  message?: string;
}

/**
 * Tells the clerk, in plain words, when live data couldn't be reached. When
 * everything is healthy we show nothing — the clerk doesn't need to be told
 * the system is working. Requirement 5.2 (no "API unavailable" / "Live API"
 * wording). The copy states the truth: the load failed and nothing real is
 * shown — it must not claim saved/cached data is being displayed.
 */
export function DataSourceBadge({ source, message }: DataSourceBadgeProps) {
  if (source !== "error") return null;

  return (
    <span
      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
      role="status"
    >
      {message ?? "Couldn't load — showing nothing"}
    </span>
  );
}
