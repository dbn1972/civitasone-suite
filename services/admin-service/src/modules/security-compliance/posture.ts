/**
 * CAP-089 — pure posture scoring. The compliance posture score is DERIVED from
 * actual persisted control pass/fail state, NOT hardcoded. not_applicable and
 * not_tested controls are excluded from the denominator; not_tested additionally
 * flags the posture as incomplete.
 */
export interface ControlLike { framework: string; status: string; }

export interface PostureResult {
  overallScore: number | null;   // 0-100, null when nothing is testable
  totalControls: number;
  passed: number;
  failed: number;
  notTested: number;
  notApplicable: number;
  complete: boolean;             // false while any control is still not_tested
  byFramework: Record<string, { score: number | null; passed: number; failed: number; total: number }>;
}

function scoreOf(passed: number, failed: number): number | null {
  const testable = passed + failed;
  return testable === 0 ? null : Math.round((passed / testable) * 100);
}

export function computePosture(controls: ControlLike[]): PostureResult {
  const byFramework: PostureResult["byFramework"] = {};
  let passed = 0, failed = 0, notTested = 0, notApplicable = 0;

  for (const c of controls) {
    const fw = (byFramework[c.framework] ??= { score: null, passed: 0, failed: 0, total: 0 });
    switch (c.status) {
      case "pass": passed++; fw.passed++; fw.total++; break;
      case "fail": failed++; fw.failed++; fw.total++; break;
      case "not_tested": notTested++; fw.total++; break;
      case "not_applicable": notApplicable++; break;
      default: break;
    }
  }
  for (const fw of Object.values(byFramework)) fw.score = scoreOf(fw.passed, fw.failed);

  return {
    overallScore: scoreOf(passed, failed),
    totalControls: controls.length,
    passed, failed, notTested, notApplicable,
    complete: notTested === 0 && passed + failed > 0,
    byFramework,
  };
}
