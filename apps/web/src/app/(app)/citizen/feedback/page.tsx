import { PageHeader, EmptyState } from "../../../_components/ds";

export default function CitizenFeedbackPage() {
  return (
    <>
      <PageHeader
        title="Citizen Feedback"
        subtitle="Feedback and suggestions submitted by citizens."
        back="/citizen"
        backLabel="Citizen Services"
      />
      <div className="card">
        <EmptyState
          icon="💬"
          title="No feedback yet"
          message="Citizen feedback submissions will appear here once the feedback module is enabled."
        />
      </div>
    </>
  );
}
