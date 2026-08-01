export default function Loading() {
  return (
    <div className="space-y-4 p-6" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
      <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
      <div className="h-64 animate-pulse rounded-lg bg-gray-100" />
    </div>
  );
}
