import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// GAP-LEARNING-HOME-04: the layout wraps children in ModuleGate(moduleKey="hrms").
// Capture the moduleKey passed to ModuleGate; stub it to render children so the
// test can assert the gate is present with the right key.
const moduleGateSpy = vi.fn();
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ moduleKey, children }: { moduleKey: string; children: React.ReactNode }) => {
    moduleGateSpy(moduleKey);
    return <div data-testid="module-gate" data-module={moduleKey}>{children}</div>;
  },
}));

import LearningLayout from "./layout";

describe("LearningLayout — GAP-LEARNING-HOME-04", () => {
  it("wraps the learning tree in a ModuleGate keyed to 'hrms'", () => {
    render(<LearningLayout>{"learning content"}</LearningLayout>);
    expect(moduleGateSpy).toHaveBeenCalledWith("hrms");
    expect(screen.getByTestId("module-gate").getAttribute("data-module")).toBe("hrms");
    expect(screen.getByText("learning content")).toBeInTheDocument();
  });
});
