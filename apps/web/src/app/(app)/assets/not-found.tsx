import { EmptyState } from "@/app/_components/ds";

export default function AssetsNotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="The page you are looking for does not exist or has been moved."
    />
  );
}
