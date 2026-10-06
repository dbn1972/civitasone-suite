import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

// SVC-121/122/124 learning loaders — thin server-side reads over the hrms-service
// endpoints, mirroring the fetchJson pattern used across apps/web.

/**
 * GAP-LEARNING-MY-LEARNING-04: the staleness window the LMS treats as
 * "overdue" for an enrolled/in-progress course. Shared by the my-learning page
 * and mirrors the server-side heuristic behind the home dashboard's overdue
 * count (learning/repo.ts countOverdueEnrollments: 30 days), so both agree.
 */
export const OVERDUE_STALE_DAYS = 30;

export type TrainingProgram = {
  id: string; title: string; category?: string; trainerName?: string;
  startDate?: string; endDate?: string; venue?: string;
  enrolledCount?: number; maxCapacity?: number; status?: string;
};
export function getTrainingPrograms(window?: { from?: string; to?: string }): Promise<LoaderResult<TrainingProgram[]>> {
  // GAP-LEARNING-CALENDAR-06: optionally request a bounded date window so the
  // calendar does not always pull the full tenant list.
  const params = new URLSearchParams();
  if (window?.from) params.set("from", window.from);
  if (window?.to) params.set("to", window.to);
  const qs = params.toString();
  return fetchJson(`/api/v1/hrms/training-programs${qs ? `?${qs}` : ""}`, [] as TrainingProgram[], {
    telemetryKey: "learning.training_programs", revalidateSeconds: 30,
    mapResponse: (x) => (Array.isArray(x) ? (x as TrainingProgram[]) : []),
  });
}

/**
 * GAP-LEARNING-CALENDAR-06: the current Indian financial year window
 * (1 Apr → 31 Mar), as bare YYYY-MM-DD strings, so the calendar requests a
 * bounded set of programmes by default.
 */
export function currentFinancialYearWindow(now: Date = new Date()): { from: string; to: string } {
  // Compute the IST calendar year/month to decide the FY boundary.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(now);
  const [yStr, mStr] = parts.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  // FY starts 1 Apr. Before April, the FY started in the previous calendar year.
  const fyStartYear = month >= 4 ? year : year - 1;
  return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` };
}

export type Course = {
  id: string; code: string; title: string; description?: string | null;
  category: string; creditHours: string; status: string;
};
export function getCourses(q?: string, status?: string): Promise<LoaderResult<Course[]>> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchJson(`/api/v1/hrms/learning/courses${qs}`, [] as Course[], {
    telemetryKey: "learning.courses", revalidateSeconds: 30,
    mapResponse: (x) => (Array.isArray(x) ? (x as Course[]) : []),
  });
}

export type Lesson = { id: string; moduleId: string; title: string; sequence: number; contentType: string; contentUri?: string | null; durationMins: number };
export type Module = { id: string; title: string; sequence: number };
export type CourseDetail = Course & { modules: Module[]; lessons: Lesson[]; prerequisites: string[] };
export function getCourseDetail(id: string): Promise<LoaderResult<CourseDetail | null>> {
  return fetchJson<CourseDetail, CourseDetail | null>(`/api/v1/hrms/learning/courses/${id}`, null, {
    telemetryKey: "learning.course_detail", revalidateSeconds: 30,
    mapResponse: (x) => (x ?? null),
  });
}

export type MyEnrollment = {
  id: string; courseId: string; courseTitle: string; courseCode: string;
  status: string; progressPct: number; resumeLessonId?: string | null;
  updatedAt?: string | null;
};
export function getMyLearning(employeeId?: string): Promise<LoaderResult<MyEnrollment[]>> {
  // GAP-LEARNING-MY-LEARNING-01/02: when no id is supplied the server scopes a
  // bare employee to their OWN record, so omit the param entirely rather than
  // sending `?employeeId=` (an empty string fails the server's uuid parse).
  const qs = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
  return fetchJson(`/api/v1/hrms/learning/my-learning${qs}`, [] as MyEnrollment[], {
    telemetryKey: "learning.my_learning", revalidateSeconds: 15,
    mapResponse: (x) => (Array.isArray(x) ? (x as MyEnrollment[]) : []),
  });
}

export type GapRow = { competencyId: string; requiredLevel: number; heldLevel: number; gap: number; met: boolean };
export type GapAnalysis = {
  employeeId: string; roleCode: string; rows: GapRow[];
  requiredCount: number; metCount: number; gapCount: number; readinessPct: number;
};
export function getGapAnalysis(employeeId: string, roleCode: string): Promise<LoaderResult<GapAnalysis | null>> {
  return fetchJson<GapAnalysis, GapAnalysis | null>(
    `/api/v1/hrms/competency/gap-analysis?employeeId=${encodeURIComponent(employeeId)}&roleCode=${encodeURIComponent(roleCode)}`,
    null, { telemetryKey: "learning.gap_analysis", revalidateSeconds: 15, mapResponse: (x) => (x ?? null) },
  );
}

export type HeldCompetency = { id: string; competencyId: string; currentLevel: number; source: string; evidenceRef?: string | null };
export function getCompetencyProfile(employeeId: string): Promise<LoaderResult<HeldCompetency[]>> {
  return fetchJson(`/api/v1/hrms/competency/employees/${encodeURIComponent(employeeId)}/profile`, [] as HeldCompetency[], {
    telemetryKey: "learning.competency_profile", revalidateSeconds: 15,
    mapResponse: (x) => (Array.isArray(x) ? (x as HeldCompetency[]) : []),
  });
}

export type Assessment = { id: string; title: string; courseRef?: string | null; passingScore: string; durationMins: number; maxAttempts: number; status: string };
export function getAssessments(): Promise<LoaderResult<Assessment[]>> {
  return fetchJson("/api/v1/hrms/assessments", [] as Assessment[], {
    telemetryKey: "learning.assessments", revalidateSeconds: 30,
    mapResponse: (x) => (Array.isArray(x) ? (x as Assessment[]) : []),
  });
}

// GAP-LEARNING-ASSESSMENTS-01: single assessment (for the attempt detail page).
export function getAssessment(id: string): Promise<LoaderResult<Assessment | null>> {
  return fetchJson<Assessment, Assessment | null>(`/api/v1/hrms/assessments/${encodeURIComponent(id)}`, null, {
    telemetryKey: "learning.assessment_detail", revalidateSeconds: 30,
    mapResponse: (x) => (x ?? null),
  });
}

// GAP-LEARNING-ASSESSMENTS-01: learner-safe questions for taking an assessment
// (no answer key — the backend strips `correct` via toLearnerSafeQuestion).
export type LearnerQuestion = { id: string; qtype: string; stem: string; options: Array<{ id: string; text: string }> };
export function getAssessmentQuestions(id: string): Promise<LoaderResult<LearnerQuestion[]>> {
  return fetchJson(`/api/v1/hrms/assessments/${encodeURIComponent(id)}/questions`, [] as LearnerQuestion[], {
    telemetryKey: "learning.assessment_questions", revalidateSeconds: 0,
    mapResponse: (x) => (Array.isArray(x) ? (x as LearnerQuestion[]) : []),
  });
}

export type CertificateVerification = {
  certificateNo: string; employeeId?: string | null; assessmentId: string;
  issuedAt: string; validUntil?: string | null; status: string;
};
export function verifyCertificate(token: string): Promise<LoaderResult<CertificateVerification | null>> {
  return fetchJson<CertificateVerification, CertificateVerification | null>(
    `/api/v1/hrms/assessment/certificates/verify/${encodeURIComponent(token)}`,
    null, { telemetryKey: "learning.verify_certificate", revalidateSeconds: 0, mapResponse: (x) => (x ?? null) },
  );
}

export type MyNomination = {
  id: string; employeeId: string; approvalState: string; status: string;
  trainingId: string; trainingTitle?: string; startDate?: string; endDate?: string; venue?: string;
  sessionId?: string; sessionTitle?: string; sessionDate?: string; waitlistPosition?: number;
  result?: string; score?: number; completedDate?: string;
};
export function getMyNominations(employeeId: string): Promise<LoaderResult<MyNomination[]>> {
  return fetchJson(`/api/v1/hrms/nominations?employeeId=${encodeURIComponent(employeeId)}`, [] as MyNomination[], {
    telemetryKey: "learning.my_nominations", revalidateSeconds: 15,
    mapResponse: (x) => (Array.isArray(x) ? (x as MyNomination[]) : []),
  });
}

export type LmsDashboardStats = {
  enrolled: number;
  in_progress: number;
  completed: number;
  overdue: number;
  total: number;
};
export function getLmsDashboard(employeeId?: string): Promise<LoaderResult<LmsDashboardStats>> {
  const qs = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
  return fetchJson<LmsDashboardStats, LmsDashboardStats>(
    `/api/v1/hrms/learning/dashboard${qs}`,
    { enrolled: 0, in_progress: 0, completed: 0, overdue: 0, total: 0 },
    { telemetryKey: "learning.dashboard", revalidateSeconds: 15, mapResponse: (x) => (x as LmsDashboardStats) },
  );
}

export type TrainingPlan = {
  id: string; title: string; planYear: number;
  departmentId?: string | null; roleCode?: string | null; status: string;
};
export type TrainingPlansPage = { data: TrainingPlan[]; total: number };
export function getTrainingPlans(opts?: { year?: number; limit?: number; offset?: number }): Promise<LoaderResult<TrainingPlansPage>> {
  const params = new URLSearchParams();
  if (opts?.year) params.set("year", String(opts.year));
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchJson<TrainingPlansPage, TrainingPlansPage>(
    `/api/v1/hrms/learning/training-plans${qs}`,
    { data: [], total: 0 },
    {
      telemetryKey: "learning.training_plans_lms", revalidateSeconds: 30,
      // Back-compat: older server builds returned a bare array; normalise both.
      mapResponse: (x) =>
        Array.isArray(x)
          ? { data: x as TrainingPlan[], total: (x as TrainingPlan[]).length }
          : ((x as TrainingPlansPage) ?? { data: [], total: 0 }),
    },
  );
}

export type LearningDepartment = { id: string; name: string; code?: string };
/** Best-effort department directory for resolving a plan's departmentId to a
 *  name (GAP-LEARNING-TRAINING-PLANS-03). A fetch failure degrades to []. */
export function getDepartments(): Promise<LoaderResult<LearningDepartment[]>> {
  return fetchJson<unknown, LearningDepartment[]>("/api/v1/hrms/departments", [] as LearningDepartment[], {
    telemetryKey: "learning.departments", revalidateSeconds: 60,
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: unknown })?.data;
      return Array.isArray(arr) ? (arr as LearningDepartment[]) : [];
    },
  });
}

export type TrainingPlanDetail = TrainingPlan & {
  items: Array<{
    id: string; courseId?: string | null; trainingId?: string | null;
    targetDate?: string | null; mandatory: number;
  }>;
};
export function getTrainingPlanDetail(id: string): Promise<LoaderResult<TrainingPlanDetail | null>> {
  return fetchJson<TrainingPlanDetail, TrainingPlanDetail | null>(
    `/api/v1/hrms/learning/training-plans/${encodeURIComponent(id)}`,
    null,
    { telemetryKey: "learning.training_plan_detail", revalidateSeconds: 30, mapResponse: (x) => (x ?? null) },
  );
}

// GAP-LEARNING-COMPETENCY-01: competency dictionary (id -> name/code), so the
// competency page can resolve raw competencyId UUIDs to human-readable names.
// Backed by GET /v1/hrms/competency/competencies (ALL_ROLES). The response is
// a flat array of competency rows.
export type CompetencyDict = { id: string; name: string; code?: string; category?: string };
export function getCompetencies(): Promise<LoaderResult<CompetencyDict[]>> {
  return fetchJson<unknown, CompetencyDict[]>("/api/v1/hrms/competency/competencies", [], {
    telemetryKey: "learning.competencies",
    revalidateSeconds: 60,
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: CompetencyDict[] })?.data;
      return Array.isArray(arr) ? (arr as CompetencyDict[]) : null;
    },
  });
}

/**
 * GAP-LEARNING-HOME-01/HOME-02/CALENDAR-01/COMPETENCY-02: the signed-in user's
 * own linked employee record. Re-exported from the shared app loader so the
 * learning pages derive "me" from the session instead of a typed ?employeeId
 * URL parameter. Returns { data: null } (not an error) when the account has no
 * linked employee record (a 404 from /me/profile).
 */
export { getMyProfile } from "@/app/_data/loaders";
