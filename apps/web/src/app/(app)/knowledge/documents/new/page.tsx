import { PageHeader } from "../../../../_components/ds";
import { getSessionRoles, KNOWLEDGE_POLICY_APPROVER_ROLES } from "@/lib/auth/roleGuard";
import { CreateDocumentForm } from "./CreateDocumentForm";

/**
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-04: renamed "Publish Document" to "Add Document"
 * because the backend creates documents as drafts. The governed publish
 * lifecycle lives in policies/[id]/PolicyActions.
 * GAP-KNOWLEDGE-DOCUMENTS-NEW-06: replaced inline hex colours in the info banner
 * with CSS token classes for dark-mode support.
 */
export default async function NewDocumentPage(props: { searchParams: Promise<{ category?: string }> }) {
  const searchParams = await props.searchParams;
  const category = typeof searchParams.category === "string" ? searchParams.category : "";
  const isSchedule = category.toLowerCase().includes("retention") || category.toLowerCase().includes("schedule");

  const roles = getSessionRoles();
  const canSetRestricted = KNOWLEDGE_POLICY_APPROVER_ROLES.some((r) => roles.includes(r));

  return (
    <div className="wrap">
      <PageHeader
        title={isSchedule ? "New Retention Schedule" : "Add Document"}
        subtitle={isSchedule
          ? "Create a records retention schedule entry."
          : "Add a circular, policy or notification to the repository."}
        back={isSchedule ? "/knowledge/records" : "/knowledge/repository"}
      />
      {isSchedule && (
        <div
          className="banner"
          style={{ background: "var(--warn-bg)", border: "1px solid var(--warn-border)", color: "var(--warn)", borderRadius: 12, padding: "11px 14px", margin: "0 0 16px", fontSize: 13, maxWidth: 820 }}
        >
          <span aria-hidden="true">ℹ️</span> Records are projected from documents — the knowledge service has no separate
          records-schedule command, so the schedule is created as a categorised document.
        </div>
      )}
      <CreateDocumentForm
        defaultCategory={category}
        backHref={isSchedule ? "/knowledge/records" : "/knowledge/repository"}
        canSetRestricted={canSetRestricted}
      />
    </div>
  );
}
