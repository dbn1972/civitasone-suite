import { EmptyState } from "@/app/_components/ds";

export default function AdminNotFound() {
  return (
    <EmptyState
      title="Configuration not found"
      message="The configuration you're looking for doesn't exist."
    />
  );
}
