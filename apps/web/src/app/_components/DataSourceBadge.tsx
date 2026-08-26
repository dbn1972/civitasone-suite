export type DataSource = "api" | "error";

interface DataSourceBadgeProps {
  source: DataSource;
  /**
   * Copy shown for the "error" state. Defaults to the historic "Showing
   * saved information" string so every existing call site (and its tests)
   * keeps behaving exactly as before.
   *
   * That default is only accurate for a genuine stale-cache scenario. As of
   * this writing `source` is produced exclusively by `fetchJson()`
   * (src/app/_data/apiClient.ts), whose `LoaderSource` type is the same
   * two-value `"api" | "error"` union as this component's — and on every
   * failure branch it returns `{ data: empty, source: "error" }`, never a
   * cached payload. So for any NEW call site, pass an accurate message, e.g.
   * `message="Couldn't load — showing nothing"`. (If a future loader adds a
   * real stale-cache path, give it a third source value rather than
   * overloading "error" for two different meanings.)
   */
  message?: string;
}

/**
 * Tells the clerk, in plain words, when live data couldn't be reached. When
 * everything is healthy we show nothing — the clerk doesn't need to be told
 * the system is working. Requirement 5.2 (no "API unavailable" / "Live API"
 * wording).
 */
export function DataSourceBadge({ source, message }: DataSourceBadgeProps) {
  if (source !== "error") return null;

  return (
    <span
      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
      role="status"
    >
      {message ?? "Showing saved information"}
    </span>
  );
}
