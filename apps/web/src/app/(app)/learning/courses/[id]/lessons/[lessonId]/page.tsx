/**
 * GAP-LEARNING-COURSES-DETAIL-03: lesson player page. Renders lesson metadata
 * and a "Mark complete" button; contentUri is shown as an external link
 * (NEVER embedded inline — CSP/XSS concern documented in the gap item).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, EmptyState, StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getCourseDetail } from "../../../../_data";
import { getMyProfile } from "@/app/_data/loaders";
import { MarkCompleteButton } from "./MarkCompleteButton";

export default async function Page({ params }: { params: { id: string; lessonId: string } }) {
  const [{ data: course, source }, { data: profile }] = await Promise.all([
    getCourseDetail(params.id),
    getMyProfile(),
  ]);

  if (source === "error") {
    return (
      <>
        <PageHeader title="Lesson" back={`/learning/courses/${params.id}`} />
        <RefreshErrorState error={toHumanError("load", { area: "lesson" })} backHref={`/learning/courses/${params.id}`} />
      </>
    );
  }
  if (!course) {
    notFound();
  }

  const lesson = course.lessons.find((l) => l.id === params.lessonId);
  if (!lesson) {
    notFound();
  }

  const moduleTitle = course.modules.find((m) => m.id === lesson.moduleId)?.title ?? "—";
  const employeeId = profile?.id ?? "";

  // A safe external link for the contentUri — never embedded in an iframe.
  const contentLink = lesson.contentUri ? sanitiseUrl(lesson.contentUri) : null;

  return (
    <>
      <PageHeader
        title={lesson.title}
        subtitle={`${course.title} — ${moduleTitle}`}
        back={`/learning/courses/${params.id}`}
        actions={
          employeeId ? (
            <MarkCompleteButton
              lessonId={lesson.id}
              employeeId={employeeId}
              alreadyComplete={false}
            />
          ) : null
        }
      />
      <StatGrid>
        <StatCard icon="🎬" iconBg="var(--panel)" label="Content type" value={lesson.contentType} />
        <StatCard icon="⏱️" iconBg="var(--panel)" label="Duration" value={lesson.durationMins ? `${lesson.durationMins} min` : "—"} />
      </StatGrid>
      <div className="card">
        <div className="card-h"><h3>Content</h3></div>
        {contentLink ? (
          <div style={{ padding: "16px 24px" }}>
            <p>Open the lesson content in a new tab:</p>
            <Link href={contentLink} target="_blank" rel="noopener noreferrer" className="btn primary" style={{ display: "inline-block", marginTop: 8 }}>
              Open content ↗
            </Link>
          </div>
        ) : (
          <EmptyState icon="📄" title="No content available" message="The content for this lesson has not been uploaded yet." />
        )}
      </div>
    </>
  );
}

/** Reject javascript: / data: URLs, allow only http / https. */
function sanitiseUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "https://placeholder.invalid");
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
    return null;
  } catch {
    return null;
  }
}
