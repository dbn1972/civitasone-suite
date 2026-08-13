import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

// SVC-121/122/124 learning loaders — thin server-side reads over the hrms-service
// endpoints, mirroring the fetchJson pattern used across apps/web.

export type TrainingProgram = {
  id: string; title: string; category?: string; trainerName?: string;
  startDate?: string; endDate?: string; venue?: string;
  enrolledCount?: number; maxCapacity?: number; status?: string;
};
export function getTrainingPrograms(): Promise<LoaderResult<TrainingProgram[]>> {
  return fetchJson("/api/v1/hrms/training-programs", [] as TrainingProgram[], {
    telemetryKey: "learning.training_programs", revalidateSeconds: 30,
    mapResponse: (x) => (Array.isArray(x) ? (x as TrainingProgram[]) : []),
  });
}

export type Course = {
  id: string; code: string; title: string; description?: string | null;
  category: string; creditHours: string; status: string;
};
export function getCourses(q?: string): Promise<LoaderResult<Course[]>> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return fetchJson(`/api/v1/hrms/learning/courses${qs}`, [] as Course[], {
    telemetryKey: "learning.courses", revalidateSeconds: 30,
    mapResponse: (x) => (Array.isArray(x) ? (x as Course[]) : []),
  });
}

export type Lesson = { id: string; title: string; sequence: number; contentType: string; contentUri?: string | null; durationMins: number };
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
};
export function getMyLearning(employeeId: string): Promise<LoaderResult<MyEnrollment[]>> {
  return fetchJson(`/api/v1/hrms/learning/my-learning?employeeId=${encodeURIComponent(employeeId)}`, [] as MyEnrollment[], {
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

export type CertificateVerification = {
  certificateNo: string; employeeId: string; assessmentId: string;
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
export function getTrainingPlans(): Promise<LoaderResult<TrainingPlan[]>> {
  return fetchJson("/api/v1/hrms/learning/training-plans", [] as TrainingPlan[], {
    telemetryKey: "learning.training_plans_lms", revalidateSeconds: 30,
    mapResponse: (x) => (Array.isArray(x) ? (x as TrainingPlan[]) : []),
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
