import { PageHeader } from "../../../_components/ds";
import { StewardQueuePanel } from "./StewardQueuePanel";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/cdp">Customer Data Platform</a>
      </nav>
      <PageHeader
        title="CDP — Data Steward"
        subtitle="Merge review queue — approve or reject profile-merge suggestions flagged by identity resolution."
      />
      <StewardQueuePanel />
    </main>
  );
}
