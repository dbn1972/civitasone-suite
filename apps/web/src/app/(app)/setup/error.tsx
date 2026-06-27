"use client";
import { EmptyState } from "@/app/_components/ds";
export default function Error() {
  return (
    <div className="page-main wrap">
      <EmptyState
        icon="🙂"
        title="We couldn't load your setup steps just now"
        message="No problem — please refresh the page to try again. Nothing you've set up so far is lost."
      />
    </div>
  );
}
