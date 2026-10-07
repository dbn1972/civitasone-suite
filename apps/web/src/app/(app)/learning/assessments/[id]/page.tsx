import { PageHeader, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getAssessment, getAssessmentQuestions, getMyProfile } from "../../_data";
import { AttemptClient } from "./AttemptClient";

/**
 * GAP-LEARNING-ASSESSMENTS-01: the attempt-taking surface. Previously the
 * assessments list promised "assessments you can attempt" but there was no
 * attempt route at all — the list was a dead end. This page lets an enrolled
 * learner start an attempt, answer the (answer-key-stripped) questions and
 * submit for an immediate score/pass result.
 *
 * The employeeId sent to POST /attempts is the viewer's own linked employee
 * id (getMyProfile); a non-HR caller's value is force-scoped server-side
 * anyway (assessment/routes.ts), so this is a self-attempt only.
 */
export default async function Page({ params }: { params: { id: string } }) {
  const [{ data: assessment, source: aSource }, { data: questions, source: qSource }, { data: me }] = await Promise.all([
    getAssessment(params.id),
    getAssessmentQuestions(params.id),
    getMyProfile(),
  ]);

  if (aSource === "error") {
    return (
      <>
        <PageHeader title="Assessment" back="/learning/assessments" />
        <RefreshErrorState error={toHumanError("load", { area: "assessment" })} backHref="/learning/assessments" />
      </>
    );
  }

  if (!assessment) {
    return (
      <>
        <PageHeader title="Assessment" back="/learning/assessments" />
        <EmptyState icon="🔍" title="Assessment not found" message="This assessment does not exist or is no longer available." />
      </>
    );
  }

  if (assessment.status !== "published") {
    return (
      <>
        <PageHeader title={assessment.title} subtitle="Assessment" back="/learning/assessments" />
        <EmptyState icon="⏳" title="Not open for attempts" message="This assessment is not published and cannot be attempted yet." />
      </>
    );
  }

  if (!me?.id) {
    return (
      <>
        <PageHeader title={assessment.title} subtitle="Assessment" back="/learning/assessments" />
        <EmptyState icon="👤" title="No employee profile linked" message="Your account is not linked to an employee record, so you cannot attempt this assessment." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={assessment.title}
        subtitle={`Pass mark: ${assessment.passingScore} marks · ${assessment.durationMins} min · up to ${assessment.maxAttempts} attempt(s)`}
        back="/learning/assessments"
      />
      <div className="card">
        <div className="card-h"><h3>Attempt</h3></div>
        {qSource === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "assessment questions" })} backHref="/learning/assessments" />
        ) : questions.length === 0 ? (
          <EmptyState icon="📝" title="No questions available" message="This assessment has no questions to attempt yet." />
        ) : (
          <AttemptClient assessmentId={assessment.id} employeeId={me.id} questions={questions} />
        )}
      </div>
    </>
  );
}
