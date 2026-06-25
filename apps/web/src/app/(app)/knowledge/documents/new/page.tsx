import { PageHeader } from "../../../../_components/ds";
import { CreateDocumentForm } from "./CreateDocumentForm";

export default function NewDocumentPage({ searchParams }: { searchParams: { category?: string } }) {
  const category = typeof searchParams.category === "string" ? searchParams.category : "";
  const isSchedule = category.toLowerCase().includes("retention") || category.toLowerCase().includes("schedule");

  return (
    <div className="wrap">
      <PageHeader
        title={isSchedule ? "New Retention Schedule" : "Publish Document"}
        subtitle={isSchedule
          ? "Create a records retention schedule entry."
          : "Add a circular, policy or notification to the repository."}
        back={isSchedule ? "/knowledge/records" : "/knowledge/repository"}
      />
      {isSchedule && (
        <div
          className="banner"
          style={{ background: "#fffaeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 12, padding: "11px 14px", margin: "0 0 16px", fontSize: 13, maxWidth: 820 }}
        >
          <span aria-hidden="true">ℹ️</span> Records are projected from documents — the knowledge service has no separate
          records-schedule command, so the schedule is created as a categorised document.
        </div>
      )}
      <CreateDocumentForm defaultCategory={category} backHref={isSchedule ? "/knowledge/records" : "/knowledge/repository"} />
    </div>
  );
}
