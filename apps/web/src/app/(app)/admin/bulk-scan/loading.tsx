export default function Loading() {
  return (
    <div className="space-y-4 p-6" role="status" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
      <div className="h-10 w-full animate-pulse rounded bg-gray-100" />
      <div className="h-64 animate-pulse rounded-lg bg-gray-100" />
    </div>
  );
}
