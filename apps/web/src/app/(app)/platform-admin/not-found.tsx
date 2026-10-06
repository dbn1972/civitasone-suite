import { EmptyState } from "@/app/_components/ds";

// GAP-PLATFORM-ADMIN-HOME-05: segment-local not-found, mirroring plugins/.
export default function PlatformAdminNotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="This Platform Admin page does not exist or has been moved."
    />
  );
}
