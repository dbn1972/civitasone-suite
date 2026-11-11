import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// M2: Payroll and Recruitment are their own module switches. ModuleGate is an async server component, so
// stub it to record the key each segment layout asks it to enforce.
const gateKeys: string[] = [];
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ moduleKey, children }: { moduleKey: string; children: React.ReactNode }) => {
    gateKeys.push(moduleKey);
    return <div data-gate={moduleKey}>{children}</div>;
  },
}));

import PayrollLayout from "./payroll/layout";
import RecruitmentLayout from "./recruitment/layout";
import JdTemplatesLayout from "./jd-templates/layout";

describe("HR sub-area layouts gate on their own module switch (M2)", () => {
  it("/hr/payroll is gated by the payroll switch", () => {
    gateKeys.length = 0;
    const { getByText } = render(<PayrollLayout>{"payroll page"}</PayrollLayout>);
    expect(gateKeys).toEqual(["payroll"]);
    expect(getByText("payroll page")).toBeInTheDocument();
  });

  it("/hr/recruitment is gated by the recruitment switch", () => {
    gateKeys.length = 0;
    render(<RecruitmentLayout>{"recruitment page"}</RecruitmentLayout>);
    expect(gateKeys).toEqual(["recruitment"]);
  });

  it("/hr/jd-templates (recruitment content) is gated by the recruitment switch", () => {
    gateKeys.length = 0;
    render(<JdTemplatesLayout>{"jd page"}</JdTemplatesLayout>);
    expect(gateKeys).toEqual(["recruitment"]);
  });
});
