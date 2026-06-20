export type DataSource = "api" | "error";

interface DataSourceBadgeProps {
  source: DataSource;
}

export function DataSourceBadge({ source }: DataSourceBadgeProps) {
  const isError = source === "error";

  return (
    <span
      className={
        isError
          ? "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
          : "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
      }
    >
      {isError ? "API unavailable" : "Live API"}
    </span>
  );
}
