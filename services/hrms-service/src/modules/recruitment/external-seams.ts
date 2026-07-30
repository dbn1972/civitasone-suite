/**
 * External integration seams for recruitment (2C checklist items).
 *
 * Each seam defines a TYPED adapter interface, a feature flag, and an honest
 * stub that returns 501 / { source: "stub" } when unwired. Nothing here fakes a
 * real integration. When a real adapter is wired (e.g. an AI provider API key is
 * configured), the stub is replaced and the feature flag gates the rollout.
 *
 * Items covered:
 *   X02 — R-RA-0088 / 0107 / 0145: AI resume parse / JD-match / question gen
 *   X03 — R-RA-0128: remote proctoring
 *   X05 — R-RA-0151 / 0159: eSign (DSC on interview proceedings / offer)
 */

// ─── X02: AI recruitment (resume parse / JD-match / question generation) ───

export interface AiResumeParseResult { skills: string[]; experience: number | null; qualification: string | null; source: "ai" | "stub"; }
export interface AiJdMatchResult { score: number; reasoning: string; source: "ai" | "stub"; }
export interface AiQuestionGenResult { questions: Array<{ text: string; difficulty: string }>; source: "ai" | "stub"; }

export interface RecruitmentAiAdapter {
  parseResume(fileKey: string): Promise<AiResumeParseResult>;
  matchJd(applicationId: string, jobOpeningId: string): Promise<AiJdMatchResult>;
  generateQuestions(opts: { jobOpeningId: string; count: number }): Promise<AiQuestionGenResult>;
}

export function aiEnabled(env: Record<string, string | undefined>): boolean {
  return env.FEATURE_RECRUITMENT_AI_ENABLED === "true";
}

export const aiStub: RecruitmentAiAdapter = {
  async parseResume() { return { skills: [], experience: null, qualification: null, source: "stub" as const }; },
  async matchJd() { return { score: 0, reasoning: "AI adapter not wired", source: "stub" as const }; },
  async generateQuestions() { return { questions: [], source: "stub" as const }; },
};

// ─── X03: Remote proctoring ────────────────────────────────────────────────

export interface ProctoringSession { sessionId: string; joinUrl: string; source: "proctor" | "stub"; }
export interface ProctoringAdapter {
  startSession(opts: { interviewId: string; candidateId: string }): Promise<ProctoringSession>;
  endSession(sessionId: string): Promise<{ ended: boolean; source: "proctor" | "stub" }>;
}

export function proctoringEnabled(env: Record<string, string | undefined>): boolean {
  return env.FEATURE_PROCTORING_ENABLED === "true";
}

export const proctoringStub: ProctoringAdapter = {
  async startSession() { return { sessionId: "stub", joinUrl: "", source: "stub" as const }; },
  async endSession() { return { ended: false, source: "stub" as const }; },
};

// ─── X05: eSign (DSC on interview proceedings / offer) ─────────────────────

export interface ESignResult { signed: boolean; signatureRef: string | null; source: "dsc" | "stub"; }
export interface ESignAdapter {
  signDocument(opts: { documentKey: string; signerRole: string }): Promise<ESignResult>;
}

export function eSignEnabled(env: Record<string, string | undefined>): boolean {
  return env.FEATURE_ESIGN_ENABLED === "true";
}

export const eSignStub: ESignAdapter = {
  async signDocument() { return { signed: false, signatureRef: null, source: "stub" as const }; },
};
