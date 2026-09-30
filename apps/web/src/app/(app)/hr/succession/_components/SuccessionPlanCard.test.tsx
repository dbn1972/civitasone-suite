import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import enMessages from "@/messages/en.json";
import { SuccessionPlanCard, type CriticalPost } from "./SuccessionPlanCard";

const successionPlanCardMessages = enMessages.successionPlanCard as Record<string, string>;

// SuccessionPlanCard takes its translator as an explicit `t` prop (a server
// component's already-resolved next-intl translator, per this file's own
// `Translator = Awaited<ReturnType<typeof getTranslations>>` type) rather
// than via a hook, so it can be a plain server component itself. A minimal
// stand-in with the same `t(key, values?)` call shape is enough to render
// it in a component test without pulling in next-intl's server runtime.
function fakeT(key: string, values?: Record<string, unknown>): string {
  const template = successionPlanCardMessages[key] ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function renderCard(post: CriticalPost) {
  return render(<SuccessionPlanCard post={post} t={fakeT as never} />);
}

function basePost(overrides: Partial<CriticalPost> = {}): CriticalPost {
  return {
    id: "role-1",
    roleRef: "Chief Test Officer",
    department: "Test Dept",
    successors: [],
    ...overrides,
  };
}

describe("SuccessionPlanCard", () => {
  // GAP-HR-SUCCESSION-01: a plan whose aggregate nominee_count is >0 but
  // has no per-nominee detail rows (should not happen once the backend
  // join is in place, but is a real possible API shape) previously showed
  // the same "no successors -- key-person risk" warning as a plan with
  // genuinely zero nominees, or (before -01) fabricated fake people.
  it("shows a real-count summary, not the no-successors warning, when nominees exist without detail rows", () => {
    renderCard(basePost({ nomineeCount: 3, successors: [] }));
    expect(screen.getByText("3 nominees, 0 ready now")).toBeInTheDocument();
    expect(screen.queryByText(/No successors identified/)).not.toBeInTheDocument();
  });

  it("still shows the no-successors warning when nomineeCount is genuinely zero", () => {
    renderCard(basePost({ nomineeCount: 0, successors: [] }));
    expect(screen.getByText(/No successors identified/)).toBeInTheDocument();
  });

  // GAP-HR-SUCCESSION-06: `s.name ?? s.employeeId` would have printed a raw
  // id if name were ever missing.
  it("shows a translated fallback, never a raw employee id, when a successor has no name", () => {
    renderCard(
      basePost({
        successors: [{ employeeId: "11111111-2222-3333-4444-555555555555", readiness: "ready_now" }],
      }),
    );
    expect(screen.getByText("Unnamed nominee")).toBeInTheDocument();
    expect(screen.queryByText("11111111-2222-3333-4444-555555555555")).not.toBeInTheDocument();
  });

  it("renders real successor names when present", () => {
    renderCard(
      basePost({
        successors: [
          { employeeId: "e1", name: "Priya Nair", readiness: "ready_now" },
          { employeeId: "e2", name: "Arjun Rao", readiness: "one_two_years" },
        ],
      }),
    );
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Arjun Rao")).toBeInTheDocument();
  });
});
