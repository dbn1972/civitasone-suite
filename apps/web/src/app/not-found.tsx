import { EmptyState } from "@/app/_components/ds";

export default function RootNotFound() {
  return (
    <EmptyState
      title="404 — Page not found"
      message="The page you are looking for does not exist or has been moved."
    />
  );
}
