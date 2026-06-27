export type DataSource = "api" | "error";

interface DataSourceBadgeProps {
  source: DataSource;
}

/**
 * Tells the clerk, in plain words, when they're looking at saved information
 * because live data couldn't be reached. When everything is healthy we show
 * nothing — the clerk doesn't need to be told the system is working.
 * Requirement 5.2 (no "API unavailable" / "Live API" wording).
 */
export function DataSourceBadge({ source }: DataSourceBadgeProps) {
  if (source !== "error") return null;

  return (
    <span
      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
      role="status"
    >
      Showing saved information
    </span>
  );
}
