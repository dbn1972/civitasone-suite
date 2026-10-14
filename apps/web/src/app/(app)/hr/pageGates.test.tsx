import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * W1 SF-09b (owner decision 2026-10-14, "allow + guard"): hiring_manager and
 * dept_head are admitted to the /hr shell (hr/layout.tsx), so each /hr page
 * that had no gate of its own now carries one mirroring its backend route's
 * requireRole list. This runs the REAL requireAnyRole against a mocked
 * session JWT and asserts, per page, who is redirected.
 */
const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: async () => ({ data: [], source: "error", status: 500 }),
}));
vi.mock("../../_data/loaders", () => ({ getOrgChart: async () => ({ data: [], source: "error" }) }));

function sessionWithRoles(roles: string[]) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  mockGet.mockReturnValue({ value: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: "u1", roles })}.sig` });
}

/** true when the page's gate lets the role through (any later render error, or the page own onward redirect, is irrelevant here). */
async function reaches(load: () => Promise<{ default: (p: never) => unknown }>, roles: string[]): Promise<boolean> {
  sessionWithRoles(roles);
  const mod = await load();
  try {
    await mod.default({ searchParams: {} } as never);
    return true;
  } catch (e) {
    return !(e instanceof Error && e.message === "REDIRECT:/dashboard");
  }
}

const PAGES: { name: string; load: () => Promise<{ default: (p: never) => unknown }>; admits: string[]; denies: string[] }[] = [
  { name: "certifications", load: () => import("./certifications/page"), admits: ["hr_admin", "employee", "manager"], denies: ["dept_head", "hiring_manager", "payroll_officer"] },
  { name: "checkin-log", load: () => import("./checkin-log/page"), admits: ["hr_officer", "manager"], denies: ["dept_head", "hiring_manager", "employee"] },
  { name: "contractual", load: () => import("./contractual/page"), admits: ["hr_admin", "manager"], denies: ["dept_head", "hiring_manager", "employee"] },
  { name: "goals", load: () => import("./goals/page"), admits: ["dept_head", "employee", "manager", "hr_admin", "payroll_officer", "icc_member"], denies: ["hiring_manager"] },
  { name: "org-chart", load: () => import("./org-chart/page"), admits: ["employee", "manager", "hr_officer"], denies: ["dept_head", "hiring_manager", "finance_officer"] },
  { name: "salary-structure", load: () => import("./salary-structure/page"), admits: ["payroll_admin", "hr_admin", "finance_officer"], denies: ["dept_head", "hiring_manager", "employee"] },
  { name: "skills", load: () => import("./skills/page"), admits: ["employee", "manager", "hr_admin"], denies: ["dept_head", "hiring_manager", "payroll_admin"] },
  { name: "social-feed", load: () => import("./social-feed/page"), admits: ["employee", "manager", "hr_officer"], denies: ["dept_head", "hiring_manager", "finance_admin"] },
  { name: "workforce", load: () => import("./workforce/page"), admits: ["hr_admin", "manager", "finance_officer"], denies: ["dept_head", "hiring_manager", "employee"] },
];

describe("hr page gates mirror backend route guards (SF-09b)", () => {
  beforeEach(() => mockGet.mockReset());

  for (const p of PAGES) {
    describe(p.name, () => {
      for (const role of p.denies) {
        it(`redirects ${role}`, async () => {
          expect(await reaches(p.load, [role])).toBe(false);
        });
      }
      for (const role of p.admits) {
        it(`admits ${role}`, async () => {
          expect(await reaches(p.load, [role])).toBe(true);
        });
      }
    });
  }
});
