import { PageHeader, EmptyState } from "@/app/_components/ds";

export default function GrantNotFound() {
  return (
    <>
      <PageHeader back="/grants/list" backLabel="All grants" title="Grant not found" />
      <main aria-label="Grant not found">
        <EmptyState
          icon="🔍"
          title="We couldn't find that grant"
          message="The grant may have been removed, or the link is incorrect. Return to the grants list to continue."
          action={
            <a href="/grants/list" className="btn primary" style={{ marginTop: 12 }}>
              Back to all grants
            </a>
          }
        />
      </main>
    </>
  );
}
